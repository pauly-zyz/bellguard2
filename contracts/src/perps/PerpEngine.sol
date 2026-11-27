// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MarketCalendar} from "../MarketCalendar.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {PerpVault, IPerpReserve} from "./PerpVault.sol";

/// @title PerpEngine
/// @notice Long or short stock prices with leverage against a liquidity vault, priced by an
///         oracle. Positions settle in the collateral token; nobody holds the stock.
///
/// "Bell mode" is what makes it fit stocks, whose prices stop over the weekend:
///  1. While the stock market is closed (per MarketCalendar) the oracle price is frozen, so
///     opening, closing and liquidating are paused. Nobody can trade the stale Friday price
///     against the vault with weekend news. Adding collateral stays open.
///  2. After the market reopens, trading needs a price published after the reopen.
///  3. In the last `preCloseWindow` before a close, new positions are capped at
///     `weekendMaxLeverage`, and anyone can trim older positions down to that cap (for a
///     small keeper fee), so fewer positions carry high leverage through a gap.
///  4. Borrow fees run `closedBorrowMultiplier` times faster over closures: LPs carry the
///     reopen gap, and are paid for it.
///
/// Every position's profit is capped at `maxProfitBps` of its collateral. The vault reserves
/// that cap while the position is open, and total reserves are limited to a share of vault
/// assets, so winners can always be paid in full.
contract PerpEngine is IPerpReserve, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ONE = 1e18;

    struct Params {
        uint16 openFeeBps; // charged on size when opening
        uint16 closeFeeBps; // charged on size when closing or liquidating
        uint16 spreadBps; // execution price is oracle price +/- spread
        uint16 maintenanceBps; // liquidation when equity < size * maintenanceBps
        uint16 liquidationFeeBps; // liquidator reward, on size, paid from remaining equity
        uint16 deleverageFeeBps; // keeper reward on the size trimmed before a close
        uint32 maxProfitBps; // profit cap per position, on collateral
        uint32 borrowBpsPerDay; // borrow fee on size, per day while open
        uint16 closedBorrowMultiplier; // borrow fee multiplier while the market is closed
        uint16 maxLeverage; // whole number, e.g. 20 = 20x
        uint16 weekendMaxLeverage; // cap in the pre-close window
        uint32 preCloseWindow; // seconds before a close where the weekend cap applies
        uint16 maxUtilizationBps; // total reserves / vault assets
        uint64 minCollateral; // in collateral token units
    }

    struct Market {
        IAggregatorV3 feed;
        uint32 maxPriceAge; // seconds
        bool active;
        uint256 maxOpenInterest; // per side, in collateral units of size
        uint256 longOpenInterest;
        uint256 shortOpenInterest;
        uint256 borrowIndex; // cumulative borrow fee per unit of size, 1e18
        uint64 lastAccrual;
        string symbol;
    }

    struct Position {
        address owner;
        uint32 market;
        bool isLong;
        uint256 collateral;
        uint256 size;
        uint256 entryPrice; // oracle decimals
        uint256 borrowIndex; // market index when last settled
        uint256 maxProfit; // reserved in the vault
        uint64 openedAt;
    }

    IERC20 public immutable collateralToken;
    PerpVault public immutable vault;
    MarketCalendar public immutable calendar;

    Params internal params;
    Market[] internal _markets;
    mapping(uint256 => Position) internal _positions;
    uint256 public nextPositionId = 1;
    uint256 public override totalReserved;
    /// @notice Emergency stop: no opening, closing, liquidating or trimming while set.
    bool public paused;

    event MarketAdded(uint256 indexed market, string symbol, address feed);
    event MarketUpdated(uint256 indexed market, bool active, uint256 maxOpenInterest, uint32 maxPriceAge);
    event ParamsSet(Params params);
    event PausedSet(bool paused);
    event PositionOpened(
        uint256 indexed id, address indexed owner, uint256 indexed market, bool isLong,
        uint256 collateral, uint256 size, uint256 price, uint256 fee
    );
    event CollateralAdded(uint256 indexed id, uint256 amount);
    event PositionClosed(uint256 indexed id, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidOut);
    event PositionLiquidated(uint256 indexed id, address indexed liquidator, uint256 price, int256 equity, uint256 reward);
    event PositionDeleveraged(uint256 indexed id, address indexed keeper, uint256 sizeBefore, uint256 sizeAfter, uint256 price);

    error MarketClosed();
    error MarketInactive();
    error StalePrice();
    error BadPrice();
    error PriceNotAcceptable();
    error CollateralTooSmall();
    error LeverageTooHigh();
    error OpenInterestCap();
    error VaultCapacity();
    error NotOwner();
    error NoPosition();
    error NotLiquidatable();
    error NotInPreCloseWindow();
    error WithinWeekendLeverage();
    error InvalidParams();
    error Paused();

    constructor(IERC20 collateralToken_, PerpVault vault_, MarketCalendar calendar_, Params memory params_, address owner_)
        Ownable(owner_)
    {
        collateralToken = collateralToken_;
        vault = vault_;
        calendar = calendar_;
        _setParams(params_);
    }

    // ------------------------------------------------------------------ admin

    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Stop all trading (for example if the price feed misbehaves). Adding collateral stays open.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    function addMarket(string calldata symbol, IAggregatorV3 feed, uint256 maxOpenInterest, uint32 maxPriceAge)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (address(feed) == address(0) || maxPriceAge == 0) revert InvalidParams();
        id = _markets.length;
        _markets.push(Market({
            feed: feed, maxPriceAge: maxPriceAge, active: true, maxOpenInterest: maxOpenInterest,
            longOpenInterest: 0, shortOpenInterest: 0, borrowIndex: 0, lastAccrual: uint64(block.timestamp), symbol: symbol
        }));
        emit MarketAdded(id, symbol, address(feed));
    }

    /// @notice Pause a market for new positions, or change its limits. Closing stays possible.
    function updateMarket(uint256 id, bool active, uint256 maxOpenInterest, uint32 maxPriceAge) external onlyOwner {
        if (maxPriceAge == 0) revert InvalidParams();
        Market storage m = _markets[id];
        _accrue(m);
        m.active = active;
        m.maxOpenInterest = maxOpenInterest;
        m.maxPriceAge = maxPriceAge;
        emit MarketUpdated(id, active, maxOpenInterest, maxPriceAge);
    }

    function _setParams(Params memory p) internal {
        if (
            p.openFeeBps > 100 || p.closeFeeBps > 100 || p.spreadBps > 100 || p.deleverageFeeBps > 100
                || p.maintenanceBps == 0 || p.maintenanceBps > 2_000 || p.liquidationFeeBps > p.maintenanceBps
                || p.maxProfitBps == 0 || p.maxProfitBps > 100_000 || p.borrowBpsPerDay > 100
                || p.closedBorrowMultiplier == 0 || p.closedBorrowMultiplier > 20
                || p.maxLeverage == 0 || p.maxLeverage > 100 || p.weekendMaxLeverage == 0
                || p.weekendMaxLeverage > p.maxLeverage || p.preCloseWindow > 1 days
                || uint256(p.weekendMaxLeverage) * p.deleverageFeeBps >= BPS
                || p.maxUtilizationBps == 0 || p.maxUtilizationBps > BPS
                || uint256(p.maintenanceBps) * p.maxLeverage >= BPS // must not be liquidatable at open
        ) revert InvalidParams();
        params = p;
        emit ParamsSet(p);
    }

    // ------------------------------------------------------------------ trading

    /// @notice Open a position. `collateral` includes the open fee; leverage is size / collateral
    ///         after the fee. `acceptablePrice` bounds the fill (0 = no bound).
    function openPosition(uint256 marketId, bool isLong, uint256 collateral, uint256 size, uint256 acceptablePrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        Params memory p = params;
        Market storage m = _markets[marketId];
        if (!m.active) revert MarketInactive();
        uint256 price = _executionPrice(m, isLong, true);
        if (acceptablePrice != 0 && (isLong ? price > acceptablePrice : price < acceptablePrice)) {
            revert PriceNotAcceptable();
        }
        _accrue(m);

        uint256 fee = size * p.openFeeBps / BPS;
        if (collateral <= fee || collateral - fee < p.minCollateral) revert CollateralTooSmall();
        uint256 net = collateral - fee;
        uint256 maxLev = inPreCloseWindow() ? p.weekendMaxLeverage : p.maxLeverage;
        if (size > net * maxLev) revert LeverageTooHigh();

        if (isLong) {
            m.longOpenInterest += size;
            if (m.longOpenInterest > m.maxOpenInterest) revert OpenInterestCap();
        } else {
            m.shortOpenInterest += size;
            if (m.shortOpenInterest > m.maxOpenInterest) revert OpenInterestCap();
        }
        uint256 maxProfit = net * p.maxProfitBps / BPS;
        totalReserved += maxProfit;
        if (totalReserved * BPS > (vault.totalAssets() + fee) * p.maxUtilizationBps) revert VaultCapacity();

        id = nextPositionId++;
        _positions[id] = Position({
            owner: msg.sender, market: uint32(marketId), isLong: isLong, collateral: net, size: size,
            entryPrice: price, borrowIndex: m.borrowIndex, maxProfit: maxProfit, openedAt: uint64(block.timestamp)
        });

        collateralToken.safeTransferFrom(msg.sender, address(this), collateral);
        if (fee > 0) collateralToken.safeTransfer(address(vault), fee);
        emit PositionOpened(id, msg.sender, marketId, isLong, net, size, price, fee);
    }

    /// @notice Add collateral to lower leverage. Works while the market is closed too.
    function addCollateral(uint256 id, uint256 amount) external nonReentrant {
        Position storage pos = _positions[id];
        if (pos.size == 0) revert NoPosition();
        pos.collateral += amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit CollateralAdded(id, amount);
    }

    /// @notice Close a position and settle profit or loss. `acceptablePrice` bounds the fill (0 = none).
    function closePosition(uint256 id, uint256 acceptablePrice) external nonReentrant whenNotPaused {
        Position memory pos = _positions[id];
        if (pos.size == 0) revert NoPosition();
        if (pos.owner != msg.sender) revert NotOwner();
        Market storage m = _markets[pos.market];
        uint256 price = _executionPrice(m, pos.isLong, false);
        if (acceptablePrice != 0 && (pos.isLong ? price < acceptablePrice : price > acceptablePrice)) {
            revert PriceNotAcceptable();
        }
        _accrue(m);

        (int256 equity, int256 pnl, uint256 borrowFee, uint256 closeFee) = _equity(pos, m, price);
        _remove(id, pos, m);
        uint256 paid = equity > 0 ? uint256(equity) : 0;
        _settle(pos.owner, pos.collateral, paid);
        emit PositionClosed(id, price, pnl, borrowFee, closeFee, paid);
    }

    /// @notice Liquidate a position whose equity fell below the maintenance margin.
    function liquidate(uint256 id) external nonReentrant whenNotPaused {
        Position memory pos = _positions[id];
        if (pos.size == 0) revert NoPosition();
        Market storage m = _markets[pos.market];
        uint256 price = _executionPrice(m, pos.isLong, false);
        _accrue(m);

        (int256 equity,,,) = _equity(pos, m, price);
        if (equity >= int256(pos.size * params.maintenanceBps / BPS)) revert NotLiquidatable();
        _remove(id, pos, m);
        uint256 reward = 0;
        if (equity > 0) {
            reward = pos.size * params.liquidationFeeBps / BPS;
            if (reward > uint256(equity)) reward = uint256(equity);
        }
        // Remaining collateral goes to the vault; the reward to the liquidator.
        if (reward > 0) collateralToken.safeTransfer(msg.sender, reward);
        if (pos.collateral > reward) collateralToken.safeTransfer(address(vault), pos.collateral - reward);
        emit PositionLiquidated(id, msg.sender, price, equity, reward);
    }

    /// @notice In the pre-close window, trim a position above the weekend leverage cap back to it.
    ///         Anyone can call; the caller earns `deleverageFeeBps` of the trimmed size.
    function deleverage(uint256 id) external nonReentrant whenNotPaused {
        if (!inPreCloseWindow()) revert NotInPreCloseWindow();
        Position storage pos = _positions[id];
        if (pos.size == 0) revert NoPosition();
        Market storage m = _markets[pos.market];
        uint256 price = _executionPrice(m, pos.isLong, false);
        _accrue(m);

        Trim memory t = _trimAmounts(pos, m, price);
        if (pos.isLong) m.longOpenInterest -= t.trimmed;
        else m.shortOpenInterest -= t.trimmed;
        uint256 oldCollateral = pos.collateral;
        uint256 sizeBefore = pos.size;
        pos.size = t.target;
        pos.collateral = t.newCollateral;
        pos.borrowIndex = m.borrowIndex;

        // Move value between the engine (collateral) and the vault, then pay the keeper.
        uint256 needed = t.newCollateral + t.keeperFee;
        if (needed > oldCollateral) vault.payOut(address(this), needed - oldCollateral);
        else if (oldCollateral > needed) collateralToken.safeTransfer(address(vault), oldCollateral - needed);
        if (t.keeperFee > 0) collateralToken.safeTransfer(msg.sender, t.keeperFee);
        emit PositionDeleveraged(id, msg.sender, sizeBefore, t.target, price);
    }

    struct Trim {
        uint256 target;
        uint256 trimmed;
        uint256 newCollateral;
        uint256 keeperFee;
    }

    /// @dev Size after trimming to the weekend cap, and the collateral left once the trimmed
    ///      share of PnL, the whole borrow fee, the close fee and the keeper fee are settled.
    function _trimAmounts(Position memory pos, Market memory m, uint256 price) internal view returns (Trim memory t) {
        Params memory p = params;
        (int256 equity, int256 pnl, uint256 borrowFee,) = _equity(pos, m, price);
        if (equity <= int256(pos.size * p.maintenanceBps / BPS)) revert NotLiquidatable(); // liquidate instead
        // Pick the target so that, after paying the keeper fee on the trimmed size, the position
        // sits exactly at the weekend cap: target = L * (E - fee * (size - target)), solved for target.
        uint256 lev = p.weekendMaxLeverage;
        uint256 feeOnAll = pos.size * p.deleverageFeeBps;
        if (uint256(equity) * BPS <= feeOnAll) revert NotLiquidatable();
        t.target = lev * (uint256(equity) * BPS - feeOnAll) / (BPS - lev * p.deleverageFeeBps);
        if (pos.size <= t.target) revert WithinWeekendLeverage();
        t.trimmed = pos.size - t.target;
        int256 realised = pnl * int256(t.trimmed) / int256(pos.size);
        t.keeperFee = t.trimmed * p.deleverageFeeBps / BPS;
        int256 left = int256(pos.collateral) + realised - int256(borrowFee + t.trimmed * p.closeFeeBps / BPS)
            - int256(t.keeperFee);
        if (left <= 0) revert NotLiquidatable();
        t.newCollateral = uint256(left);
    }

    /// @notice Bring a market's borrow index up to date (keepers call this around closures).
    function poke(uint256 marketId) external {
        _accrue(_markets[marketId]);
    }

    // ------------------------------------------------------------------ views

    function getParams() external view returns (Params memory) {
        return params;
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function market(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    function position(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    /// @notice True in the window before a market close where the weekend leverage cap applies.
    function inPreCloseWindow() public view returns (bool) {
        return !calendar.isClosedNow() && calendar.isClosed(block.timestamp + params.preCloseWindow);
    }

    /// @notice Current value of a position at the closing price, and whether it can be liquidated.
    ///         Reverts like trading does when the price can't be used (market closed, stale).
    function positionValue(uint256 id)
        external
        view
        returns (int256 equity, int256 pnl, uint256 borrowFee, uint256 closeFee, bool liquidatable)
    {
        Position memory pos = _positions[id];
        if (pos.size == 0) revert NoPosition();
        Market memory m = _markets[pos.market];
        m.borrowIndex = _pendingIndex(m);
        uint256 price = _executionPrice(m, pos.isLong, false);
        (equity, pnl, borrowFee, closeFee) = _equity(pos, m, price);
        liquidatable = equity < int256(pos.size * params.maintenanceBps / BPS);
    }

    // ------------------------------------------------------------------ internals

    function _settle(address to, uint256 collateral, uint256 paid) internal {
        if (paid > collateral) {
            collateralToken.safeTransfer(to, collateral);
            vault.payOut(to, paid - collateral);
        } else {
            if (paid > 0) collateralToken.safeTransfer(to, paid);
            if (collateral > paid) collateralToken.safeTransfer(address(vault), collateral - paid);
        }
    }

    function _remove(uint256 id, Position memory pos, Market storage m) internal {
        if (pos.isLong) m.longOpenInterest -= pos.size;
        else m.shortOpenInterest -= pos.size;
        totalReserved -= pos.maxProfit;
        delete _positions[id];
    }

    function _equity(Position memory pos, Market memory m, uint256 price)
        internal
        view
        returns (int256 equity, int256 pnl, uint256 borrowFee, uint256 closeFee)
    {
        int256 move = int256(price) - int256(pos.entryPrice);
        pnl = int256(pos.size) * (pos.isLong ? move : -move) / int256(pos.entryPrice);
        if (pnl > int256(pos.maxProfit)) pnl = int256(pos.maxProfit);
        borrowFee = pos.size * (m.borrowIndex - pos.borrowIndex) / ONE;
        closeFee = pos.size * params.closeFeeBps / BPS;
        equity = int256(pos.collateral) + pnl - int256(borrowFee) - int256(closeFee);
    }

    /// @dev Oracle price with spread, after the bell-mode checks.
    function _executionPrice(Market memory m, bool isLong, bool opening) internal view returns (uint256) {
        if (calendar.isClosedNow()) revert MarketClosed();
        (, int256 answer,, uint256 updatedAt,) = m.feed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (block.timestamp - updatedAt > m.maxPriceAge) revert StalePrice();
        if (updatedAt < calendar.lastClosureEnd(block.timestamp)) revert StalePrice(); // pre-weekend price
        uint256 px = uint256(answer);
        // Buyers pay up, sellers receive less: opening a long or closing a short is a buy.
        bool buying = opening == isLong;
        return buying ? px * (BPS + params.spreadBps) / BPS : px * (BPS - params.spreadBps) / BPS;
    }

    function _accrue(Market storage m) internal {
        m.borrowIndex = _pendingIndex(m);
        m.lastAccrual = uint64(block.timestamp);
    }

    /// @dev Borrow index now. Time spent in a closure counts `closedBorrowMultiplier` times.
    ///      Assumes at most one closure since the last accrual; keepers poke markets weekly.
    function _pendingIndex(Market memory m) internal view returns (uint256) {
        uint256 last = m.lastAccrual;
        if (block.timestamp <= last) return m.borrowIndex;
        uint256 elapsed = block.timestamp - last;
        uint256 closedSecs = 0;
        (bool closedNow,, MarketCalendar.Window memory w) = calendar.closureAt(block.timestamp);
        if (closedNow) {
            closedSecs = block.timestamp - (last > w.start ? last : w.start);
        } else {
            uint256 end = calendar.lastClosureEnd(block.timestamp);
            if (end > last) {
                (, , MarketCalendar.Window memory prev) = calendar.closureAt(end - 1);
                closedSecs = end - (last > prev.start ? last : prev.start);
            }
        }
        uint256 weighted = elapsed + closedSecs * (uint256(params.closedBorrowMultiplier) - 1);
        // bps/day -> per-second rate in 1e18 units
        return m.borrowIndex + weighted * uint256(params.borrowBpsPerDay) * 1e14 / 1 days;
    }
}
