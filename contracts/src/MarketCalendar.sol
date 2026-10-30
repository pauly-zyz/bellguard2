// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

/// @title MarketCalendar
/// @notice On-chain record of when the underlying stock market is closed, plus
///         per-asset event windows (earnings, index rebalances) that carry extra
///         gap risk. Bellguard's hook reads it to price the cover premium, and
///         settlement reads it to know which window a claim belongs to.
///
/// Windows are computed off-chain (weekends, holidays, daylight-saving shifts:
/// see research/gapscan/calendar.py) and published ahead of time. To keep
/// claims honest, nothing can be added, changed or cancelled less than
/// `minNotice` seconds before it starts, and past windows are immutable.
contract MarketCalendar {
    struct Window {
        uint64 start; // inclusive, unix seconds
        uint64 end; // exclusive: the market reopens at `end`
    }

    struct EventWindow {
        uint64 start;
        uint64 end;
        uint32 riskMultiplierBps; // 10_000 = 1x premium, 25_000 = 2.5x
    }

    uint256 public constant MAX_CLOSURE = 7 days;
    uint256 public constant MAX_EVENT = 3 days;
    uint32 public constant MIN_MULTIPLIER_BPS = 10_000;
    uint32 public constant MAX_MULTIPLIER_BPS = 100_000;

    /// @notice Minimum lead time for any change to the schedule.
    uint256 public immutable minNotice;

    address public owner;
    address public pendingOwner;

    Window[] internal _closures; // sorted, non-overlapping
    mapping(address asset => EventWindow[]) internal _events; // sorted, non-overlapping per asset

    event ClosureAdded(uint256 indexed index, uint64 start, uint64 end);
    event ClosureCancelled(uint64 start, uint64 end);
    event EventAdded(address indexed asset, uint64 start, uint64 end, uint32 riskMultiplierBps);
    event EventCancelled(address indexed asset, uint64 start, uint64 end);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error TooLate(uint256 start, uint256 earliestAllowed);
    error BadWindow(uint256 start, uint256 end);
    error Overlap(uint256 start, uint256 previousEnd);
    error BadMultiplier(uint256 bps);
    error IndexOutOfRange(uint256 index);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, uint256 minNotice_) {
        owner = initialOwner;
        minNotice = minNotice_;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    // ---------------------------------------------------------------- closures

    /// @notice Append future closures. They must be in order and must start
    ///         after the last scheduled closure ends.
    function addClosures(Window[] calldata windows) external onlyOwner {
        uint256 earliest = block.timestamp + minNotice;
        uint256 n = _closures.length;
        uint256 prevEnd = n == 0 ? 0 : _closures[n - 1].end;
        for (uint256 i; i < windows.length; ++i) {
            Window calldata w = windows[i];
            if (w.start < earliest) revert TooLate(w.start, earliest);
            if (w.end <= w.start || w.end - w.start > MAX_CLOSURE) revert BadWindow(w.start, w.end);
            if (w.start < prevEnd) revert Overlap(w.start, prevEnd);
            _closures.push(w);
            emit ClosureAdded(n + i, w.start, w.end);
            prevEnd = w.end;
        }
    }

    /// @notice Cancel a closure that has not started yet (respecting minNotice).
    function cancelClosure(uint256 index) external onlyOwner {
        uint256 n = _closures.length;
        if (index >= n) revert IndexOutOfRange(index);
        Window memory w = _closures[index];
        uint256 earliest = block.timestamp + minNotice;
        if (w.start < earliest) revert TooLate(w.start, earliest);
        for (uint256 i = index; i + 1 < n; ++i) {
            _closures[i] = _closures[i + 1];
        }
        _closures.pop();
        emit ClosureCancelled(w.start, w.end);
    }

    function closureCount() external view returns (uint256) {
        return _closures.length;
    }

    function closure(uint256 index) external view returns (Window memory) {
        if (index >= _closures.length) revert IndexOutOfRange(index);
        return _closures[index];
    }

    /// @notice Whether the market is closed at `timestamp`, and which window.
    function closureAt(uint256 timestamp) public view returns (bool closed, uint256 index, Window memory w) {
        (bool found, uint256 i) = _lastStartingAtOrBefore(_closures, timestamp);
        if (found && timestamp < _closures[i].end) return (true, i, _closures[i]);
        return (false, 0, w);
    }

    function isClosed(uint256 timestamp) external view returns (bool closed) {
        (closed,,) = closureAt(timestamp);
    }

    function isClosedNow() external view returns (bool closed) {
        (closed,,) = closureAt(block.timestamp);
    }

    // ------------------------------------------------------------------ events

    function addEvent(address asset, EventWindow calldata e) external onlyOwner {
        uint256 earliest = block.timestamp + minNotice;
        if (e.start < earliest) revert TooLate(e.start, earliest);
        if (e.end <= e.start || e.end - e.start > MAX_EVENT) revert BadWindow(e.start, e.end);
        if (e.riskMultiplierBps < MIN_MULTIPLIER_BPS || e.riskMultiplierBps > MAX_MULTIPLIER_BPS) {
            revert BadMultiplier(e.riskMultiplierBps);
        }
        EventWindow[] storage list = _events[asset];
        uint256 n = list.length;
        if (n != 0 && e.start < list[n - 1].end) revert Overlap(e.start, list[n - 1].end);
        list.push(e);
        emit EventAdded(asset, e.start, e.end, e.riskMultiplierBps);
    }

    function cancelEvent(address asset, uint256 index) external onlyOwner {
        EventWindow[] storage list = _events[asset];
        uint256 n = list.length;
        if (index >= n) revert IndexOutOfRange(index);
        EventWindow memory e = list[index];
        uint256 earliest = block.timestamp + minNotice;
        if (e.start < earliest) revert TooLate(e.start, earliest);
        for (uint256 i = index; i + 1 < n; ++i) {
            list[i] = list[i + 1];
        }
        list.pop();
        emit EventCancelled(asset, e.start, e.end);
    }

    function eventCount(address asset) external view returns (uint256) {
        return _events[asset].length;
    }

    function eventAt(address asset, uint256 index) external view returns (EventWindow memory) {
        if (index >= _events[asset].length) revert IndexOutOfRange(index);
        return _events[asset][index];
    }

    /// @notice Premium multiplier for `asset` at `timestamp` (10_000 when no event).
    function riskMultiplierBps(address asset, uint256 timestamp) external view returns (uint256) {
        EventWindow[] storage list = _events[asset];
        uint256 n = list.length;
        if (n == 0 || timestamp < list[0].start) return MIN_MULTIPLIER_BPS;
        uint256 lo;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (list[mid].start <= timestamp) lo = mid;
            else hi = mid - 1;
        }
        EventWindow storage e = list[lo];
        return timestamp < e.end ? e.riskMultiplierBps : MIN_MULTIPLIER_BPS;
    }

    // --------------------------------------------------------------- ownership

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- internal

    function _lastStartingAtOrBefore(Window[] storage list, uint256 timestamp)
        private
        view
        returns (bool found, uint256 index)
    {
        uint256 n = list.length;
        if (n == 0 || timestamp < list[0].start) return (false, 0);
        uint256 lo;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (list[mid].start <= timestamp) lo = mid;
            else hi = mid - 1;
        }
        return (true, lo);
    }
}
