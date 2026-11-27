// Bellguard Perps (long/short stock prices) on Elysium mainnet, collateral USDC.
// `deployment` is contracts/deployments/perps-99901.json (deployed 2026-11-27).
window.BELLGUARD_PERPS = {
  chainId: 99901,
  chain: {
    name: "Elysium",
    rpc: "https://rpc.elysium.kinetiq.xyz",
    relay: "/api/rpc?chain=99901",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    explorer: "https://elysium.kinetiq.xyz",
  },
  collateralSymbol: "USDC",
  owner: "0x4b08C1DbE28e4e260037299e8cb4B34c7FBe2195",
  // Where preview prices and charts come from (Chainlink feeds).
  source: { chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", relay: "/api/rpc?chain=4663", multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  deployment: {
    "chainId": 99901,
    "collateral": "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65",
    "calendar": "0x93bBBc85841869DcB4C559e80C96986fBa1956C2",
    "vault": "0x8ac90e41e8d569A7645C823521939517b8cc4aD9",
    "engine": "0x44d1b20C4827348e2B83e968210283BdBAC63d60",
    "keeper": "0x63fB46e76D317Cf1af98bbc7dB9584a672dB2ACD",
    "testToken": false,
    "owner": "0x4b08C1DbE28e4e260037299e8cb4B34c7FBe2195",
    "closures": 55,
    "markets": [
      {
        "symbol": "TSLA",
        "name": "Tesla",
        "market": 0,
        "feed": "0x879Ab3bC3ca3dF3C2092bf29a4Dcc05a3128f3E3"
      },
      {
        "symbol": "NVDA",
        "name": "NVIDIA",
        "market": 1,
        "feed": "0x388dBfaBa025E2F7e5180a87F522382A4ec595d3"
      },
      {
        "symbol": "AAPL",
        "name": "Apple",
        "market": 2,
        "feed": "0x38FD10328e93Acdd6CC5F2F164CCe528796c833B"
      },
      {
        "symbol": "AMZN",
        "name": "Amazon",
        "market": 3,
        "feed": "0xD458E823F36FF2F007a0d9d16206a2cFb2b18bd2"
      },
      {
        "symbol": "GOOGL",
        "name": "Alphabet",
        "market": 4,
        "feed": "0x7Ab5452ad770C1643Bab2Be4cb726BE4954480C0"
      },
      {
        "symbol": "META",
        "name": "Meta",
        "market": 5,
        "feed": "0x1A75B4FF3cdBc0a6970aF46ACc5B65f049b1E82d"
      },
      {
        "symbol": "MSFT",
        "name": "Microsoft",
        "market": 6,
        "feed": "0xa6Bce9ad352078D43DD6c224345263f9BC811BE4"
      },
      {
        "symbol": "PLTR",
        "name": "Palantir",
        "market": 7,
        "feed": "0x0c8331bF6d5297F669C3a7616B18ff769bD41472"
      },
      {
        "symbol": "COIN",
        "name": "Coinbase",
        "market": 8,
        "feed": "0xcA74DFF41b3a05959C80c96aa300cBf01fc9bA2C"
      },
      {
        "symbol": "MSTR",
        "name": "Strategy",
        "market": 9,
        "feed": "0x1DB67ec814C381ab0aF3cc7ffDdF59B9E83a52fe"
      },
      {
        "symbol": "SPY",
        "name": "S&P 500 ETF",
        "market": 10,
        "feed": "0xeB0ceC4714d60319df8aa44C84326d04C96b0973"
      },
      {
        "symbol": "QQQ",
        "name": "Nasdaq-100 ETF",
        "market": 11,
        "feed": "0x195F84c99e8f1bD58C2b3D5720a1897484f35B7A"
      }
    ]
  },
  markets: [
    {
      "symbol": "TSLA",
      "name": "Tesla",
      "sourceFeed": "0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6",
      "logo": "logos/TSLA.png"
    },
    {
      "symbol": "NVDA",
      "name": "NVIDIA",
      "sourceFeed": "0xCF169363636D73dbBf77733629CB38919d14232d",
      "logo": "logos/NVDA.png"
    },
    {
      "symbol": "AAPL",
      "name": "Apple",
      "sourceFeed": "0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f",
      "logo": "logos/AAPL.png"
    },
    {
      "symbol": "AMZN",
      "name": "Amazon",
      "sourceFeed": "0x9244830430bC7D9C9A48dd47603F24AD61f7c56e",
      "logo": "logos/AMZN.png"
    },
    {
      "symbol": "GOOGL",
      "name": "Alphabet",
      "sourceFeed": "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
      "logo": "logos/GOOGL.png"
    },
    {
      "symbol": "META",
      "name": "Meta",
      "sourceFeed": "0x5cBC53D382E56cBb223f118CF8Eefb6c9c2759f5",
      "logo": "logos/META.png"
    },
    {
      "symbol": "MSFT",
      "name": "Microsoft",
      "sourceFeed": "0xaD6D88eab22aa4867Efe807a5311Ed64962f740D",
      "logo": "logos/MSFT.png"
    },
    {
      "symbol": "PLTR",
      "name": "Palantir",
      "sourceFeed": "0x8cd1DFC0fc61fcA55FA77b37e008A90f13364Fce",
      "logo": "logos/PLTR.png"
    },
    {
      "symbol": "COIN",
      "name": "Coinbase",
      "sourceFeed": "0xA7F7D79D578fb007384BaDF42c8E1D76a6a63bBD",
      "logo": "logos/COIN.png"
    },
    {
      "symbol": "MSTR",
      "name": "Strategy",
      "sourceFeed": "0x2521a77F42098357e83bDea7fBb2A38745bf9280",
      "logo": "logos/MSTR.png"
    },
    {
      "symbol": "SPY",
      "name": "S&P 500 ETF",
      "sourceFeed": "0xa68CA83408bE3f78d1c58a82081c619e9d21486d",
      "type": "ETF"
    },
    {
      "symbol": "QQQ",
      "name": "Nasdaq-100 ETF",
      "sourceFeed": "0x41ed2c58611790af0760e31e80Bb427e4e83D603",
      "type": "ETF"
    }
  ],
};
