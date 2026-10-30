"""Robinhood Chain (chain id 4663) constants.

Addresses were checked on-chain on 2026-10-30 (bytecode present, events
decoded as expected). Sources are listed in docs/robinhood-chain.md.
"""

from .keccak import topic

CHAIN_ID = 4663

# Uniswap v4 (official deployments page, deploy block 9070)
POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"
POOL_MANAGER_DEPLOY_BLOCK = 9070

# Robinhood stock tokens are all created by this factory.
STOCK_FACTORY = "0x4783c67b63de2b358ac5951a7d41f47a38f3c046"

# Quote tokens. USDG has 6 decimals; stock tokens have 18.
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
QUOTE_TOKENS = {USDG: "USDG", WETH: "WETH"}

TOPIC_INITIALIZE = topic("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")
TOPIC_SWAP = topic("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
# StockFactory creation event. Signature not published; layout verified
# empirically: data = (address token, string name, string symbol).
TOPIC_STOCK_CREATED = "0xd9b0c6a1c0de228715ad0fa09f3259686ee84f8cc675e03ef7e47a9cdafa76d6"

DYNAMIC_FEE_FLAG = 0x800000
