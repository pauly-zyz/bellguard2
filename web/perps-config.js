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
  // Pay with native HYPE: swapped to USDC through Uniswap v4 (Universal Router) before opening.
  // Pool: native HYPE / USDC, 0.3%, no hooks (the deepest hookless HYPE/USDC pool, checked 2026-11-27).
  swap: {
    symbol: "HYPE",
    router: "0xA13f7611115752DEB2B13813BDDE16A5073e4b45",
    poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1",
    poolKey: { currency0: "0x0000000000000000000000000000000000000000", currency1: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" },
    slippageBps: 150,
    gasReserve: "0.005",
  },
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
      },
      {
        "symbol": "AMD",
        "name": "AMD",
        "market": 12,
        "feed": "0x4389c58c527c4783f6EC8049Ecf956AB90ad0fB5"
      },
      {
        "symbol": "ASML",
        "name": "ASML (Netherlands)",
        "market": 13,
        "feed": "0x0803B2dCC758B196798249113a1473dB60945cD4"
      },
      {
        "symbol": "BABA",
        "name": "Alibaba (China)",
        "market": 14,
        "feed": "0x4A0671ced0973598B2a5927324118BC345785656"
      },
      {
        "symbol": "CLSK",
        "name": "CleanSpark",
        "market": 15,
        "feed": "0x9b311c7F6106968fFE603270FE71D50b3aCeFf7b"
      },
      {
        "symbol": "CRCL",
        "name": "Circle",
        "market": 16,
        "feed": "0x5e30E1a42D0e44Fa7C8EE57d130e7Fc3fDf6499f"
      },
      {
        "symbol": "CRWV",
        "name": "CoreWeave",
        "market": 17,
        "feed": "0xe917c36aB6d0a2abB11E22e05FCF0B8869D31168"
      },
      {
        "symbol": "DELL",
        "name": "Dell",
        "market": 18,
        "feed": "0x3f876caBFA75b01753C873bd61865DadF03AD050"
      },
      {
        "symbol": "EWY",
        "name": "South Korea ETF",
        "market": 19,
        "feed": "0x8F7A91Da165442aF155897a526bBf3E175074Ba2"
      },
      {
        "symbol": "GME",
        "name": "GameStop",
        "market": 20,
        "feed": "0x6932c61dADb69C38156c1a9eBe39FFA5c25357Dd"
      },
      {
        "symbol": "INTC",
        "name": "Intel",
        "market": 21,
        "feed": "0x909f5C66426DdC40e5d49D60b480C4Ffeb83b52b"
      },
      {
        "symbol": "IONQ",
        "name": "IonQ",
        "market": 22,
        "feed": "0xA27d7e6390ca3559D7F00CEAF3c5073620B8d949"
      },
      {
        "symbol": "MU",
        "name": "Micron",
        "market": 23,
        "feed": "0x1ae9F6463F9C7AE6A0E646B8C68a2cB9D3aa0AAc"
      },
      {
        "symbol": "NBIS",
        "name": "Nebius (Netherlands)",
        "market": 24,
        "feed": "0x179D531BE675E83Ae5395Ddba9826944B061420d"
      },
      {
        "symbol": "ORCL",
        "name": "Oracle",
        "market": 25,
        "feed": "0xEA7eCcE54922a5b0323b647e8931dD1da1E4DaA0"
      },
      {
        "symbol": "RGTI",
        "name": "Rigetti",
        "market": 26,
        "feed": "0x3c37BC11cd8865edC6e0568B3806ee933E7DeC7b"
      },
      {
        "symbol": "RKLB",
        "name": "Rocket Lab",
        "market": 27,
        "feed": "0x0F91367157Fc67Df10Fb11C75b1c2FaaE0875941"
      },
      {
        "symbol": "SLV",
        "name": "Silver ETF",
        "market": 28,
        "feed": "0xa87D3Db63004A4EECEaF4Df4C1c82Ac61A81Ea49"
      },
      {
        "symbol": "SNDK",
        "name": "Sandisk",
        "market": 29,
        "feed": "0x7f7843898337213139F74eFe6E7f81aaFC8803eA"
      },
      {
        "symbol": "SPCX",
        "name": "SpaceX",
        "market": 30,
        "feed": "0x7987F5E39098f4191B21E7fd388A4cd972083ca7"
      },
      {
        "symbol": "TSM",
        "name": "TSMC (Taiwan)",
        "market": 31,
        "feed": "0x987bDA8C9489a29169Bd1e5185F8fDF8178D90f6"
      },
      {
        "symbol": "USAR",
        "name": "USA Rare Earth",
        "market": 32,
        "feed": "0xd032ABF824Af2B2AFC0B470F8c2f57f1933996F0"
      },
      {
        "symbol": "USO",
        "name": "Oil ETF",
        "market": 33,
        "feed": "0xd2dAf452897D7E37De51318b4Ca31001a6037927"
      }
    ],
    "maxLeverage": 20
  },

  markets: [
    {
      "symbol": "TSLA",
      "name": "Tesla",
      "sourceFeed": "0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6",
      "logo": "logos/TSLA.png",
      "country": "United States"
    },
    {
      "symbol": "NVDA",
      "name": "NVIDIA",
      "sourceFeed": "0xCF169363636D73dbBf77733629CB38919d14232d",
      "logo": "logos/NVDA.png",
      "country": "United States"
    },
    {
      "symbol": "AAPL",
      "name": "Apple",
      "sourceFeed": "0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f",
      "logo": "logos/AAPL.png",
      "country": "United States"
    },
    {
      "symbol": "AMZN",
      "name": "Amazon",
      "sourceFeed": "0x9244830430bC7D9C9A48dd47603F24AD61f7c56e",
      "logo": "logos/AMZN.png",
      "country": "United States"
    },
    {
      "symbol": "GOOGL",
      "name": "Alphabet",
      "sourceFeed": "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
      "logo": "logos/GOOGL.png",
      "country": "United States"
    },
    {
      "symbol": "META",
      "name": "Meta",
      "sourceFeed": "0x5cBC53D382E56cBb223f118CF8Eefb6c9c2759f5",
      "logo": "logos/META.png",
      "country": "United States"
    },
    {
      "symbol": "MSFT",
      "name": "Microsoft",
      "sourceFeed": "0xaD6D88eab22aa4867Efe807a5311Ed64962f740D",
      "logo": "logos/MSFT.png",
      "country": "United States"
    },
    {
      "symbol": "PLTR",
      "name": "Palantir",
      "sourceFeed": "0x8cd1DFC0fc61fcA55FA77b37e008A90f13364Fce",
      "logo": "logos/PLTR.png",
      "country": "United States"
    },
    {
      "symbol": "COIN",
      "name": "Coinbase",
      "sourceFeed": "0xA7F7D79D578fb007384BaDF42c8E1D76a6a63bBD",
      "logo": "logos/COIN.png",
      "country": "United States"
    },
    {
      "symbol": "MSTR",
      "name": "Strategy",
      "sourceFeed": "0x2521a77F42098357e83bDea7fBb2A38745bf9280",
      "logo": "logos/MSTR.png",
      "country": "United States"
    },
    {
      "symbol": "SPY",
      "name": "S&P 500 ETF",
      "sourceFeed": "0xa68CA83408bE3f78d1c58a82081c619e9d21486d",
      "type": "ETF",
      "country": "United States"
    },
    {
      "symbol": "QQQ",
      "name": "Nasdaq-100 ETF",
      "sourceFeed": "0x41ed2c58611790af0760e31e80Bb427e4e83D603",
      "type": "ETF",
      "country": "United States"
    },
    {
      "symbol": "AMD",
      "name": "AMD",
      "sourceFeed": "0xF6d57763DFa625F4A413485261Ab2E71Ff4304CF",
      "logo": "logos/AMD.png",
      "country": "United States"
    },
    {
      "symbol": "ASML",
      "name": "ASML",
      "sourceFeed": "0x3eFBba343e2b1cF9ed4d4D5768e20B70307Aa8c9",
      "logo": "logos/ASML.png",
      "country": "Netherlands"
    },
    {
      "symbol": "BABA",
      "name": "Alibaba",
      "sourceFeed": "0xDB69948B26050818E8c9f43300F78b2582e67260",
      "logo": "logos/BABA.png",
      "country": "China"
    },
    {
      "symbol": "CLSK",
      "name": "CleanSpark",
      "sourceFeed": "0x951C5E9a2a065053035D4B812b1f6cA7e64c5102",
      "logo": "logos/CLSK.png",
      "country": "United States"
    },
    {
      "symbol": "CRCL",
      "name": "Circle",
      "sourceFeed": "0x025Ba3B3569Ca7d15Da7BFC1648F13F06A072851",
      "country": "United States"
    },
    {
      "symbol": "CRWV",
      "name": "CoreWeave",
      "sourceFeed": "0x288b837A17fED1aa00c1df832ef79D0C77336c10",
      "country": "United States"
    },
    {
      "symbol": "DELL",
      "name": "Dell",
      "sourceFeed": "0xe9B94828424a8Efe6e773c28AB5Fd486851867c8",
      "logo": "logos/DELL.png",
      "country": "United States"
    },
    {
      "symbol": "EWY",
      "name": "South Korea ETF",
      "sourceFeed": "0x26bca2a89D2D23787ada8F91B849608c51A26977",
      "type": "ETF",
      "country": "South Korea"
    },
    {
      "symbol": "GME",
      "name": "GameStop",
      "sourceFeed": "0x42A4652D447A5B0bccF3B265bE8530b85A33b3A2",
      "logo": "logos/GME.png",
      "country": "United States"
    },
    {
      "symbol": "INTC",
      "name": "Intel",
      "sourceFeed": "0x127B1DeDeE6269E962a59E6C1295b4002c56c403",
      "logo": "logos/INTC.png",
      "country": "United States"
    },
    {
      "symbol": "IONQ",
      "name": "IonQ",
      "sourceFeed": "0x926D7D95E554D1e671EB2C0d238fe37a2C23A64E",
      "logo": "logos/IONQ.png",
      "country": "United States"
    },
    {
      "symbol": "MU",
      "name": "Micron",
      "sourceFeed": "0x5b40F4E78FA58B60a4F59b8cc8cB8d2Fb0690467",
      "logo": "logos/MU.png",
      "country": "United States"
    },
    {
      "symbol": "NBIS",
      "name": "Nebius",
      "sourceFeed": "0xCa59A8F53bf4E0628CC0b1BD3a2216F2F8E04770",
      "logo": "logos/NBIS.png",
      "country": "Netherlands"
    },
    {
      "symbol": "ORCL",
      "name": "Oracle",
      "sourceFeed": "0x2a07f8d87d369Bd8Bc36472337ae02d512a7b5e5",
      "logo": "logos/ORCL.png",
      "country": "United States"
    },
    {
      "symbol": "RGTI",
      "name": "Rigetti",
      "sourceFeed": "0xC9C477AEfF7eD1BB89B84F7907E2e11707491466",
      "logo": "logos/RGTI.png",
      "country": "United States"
    },
    {
      "symbol": "RKLB",
      "name": "Rocket Lab",
      "sourceFeed": "0x955c60932E517B36be137Eee78E65343cBFC9D29",
      "logo": "logos/RKLB.png",
      "country": "United States"
    },
    {
      "symbol": "SLV",
      "name": "Silver ETF",
      "sourceFeed": "0xdA81cD9c76F1D3Ea32655dfFc7408ef22BB0Ee2a",
      "type": "ETF",
      "country": "Commodities"
    },
    {
      "symbol": "SNDK",
      "name": "Sandisk",
      "sourceFeed": "0xd1016D9Da414B13D55abe02221A8A145eB89aA0D",
      "country": "United States"
    },
    {
      "symbol": "SPCX",
      "name": "SpaceX",
      "sourceFeed": "0x42a95341ff361e81fd934F39943c5C98F6991844",
      "logo": "logos/SPCX.png",
      "country": "United States"
    },
    {
      "symbol": "TSM",
      "name": "TSMC",
      "sourceFeed": "0xB48D6D5729Ca032ca43729F4b605bBf9f257A84d",
      "logo": "logos/TSM.png",
      "country": "Taiwan"
    },
    {
      "symbol": "USAR",
      "name": "USA Rare Earth",
      "sourceFeed": "0x451B1295aA84FD6d6b58af1a5002eA1b1A1913A0",
      "country": "United States"
    },
    {
      "symbol": "USO",
      "name": "Oil ETF",
      "sourceFeed": "0x6D054DECb74Cf8ef3675B0Abc100e02921176EdF",
      "logo": "logos/USO.png",
      "type": "ETF",
      "country": "Commodities"
    },
    {
      "symbol": "PDD",
      "name": "PDD Holdings (Temu)",
      "pyth": "0xae69f62081eb15ae4f077397871a1cf29cacf75e7b1db740aed9074c1efd3fa4",
      "country": "China",
      "pending": true,
      "feed": "0x121Bba5ea7fCE8424f9f42ba39fd152e45062709",
      "logo": "logos/PDD.png"
    },
    {
      "symbol": "JD",
      "name": "JD.com",
      "pyth": "0x4c45e26d5253283ab4736b4f4ba9d0e6517679f8425ef07722dacc4b6da90750",
      "country": "China",
      "pending": true,
      "feed": "0xa3aAd6A026D2240a916fdd0ed10b50Ea4196Cf77",
      "logo": "logos/JD.png"
    },
    {
      "symbol": "BIDU",
      "name": "Baidu",
      "pyth": "0x9bdee8cb689424d01f6eaf7217adfcff65b51a30774a77fff8006c21c7059350",
      "country": "China",
      "pending": true,
      "feed": "0xe73e555098206b6fD9cD757F81d2777Eed4958C6",
      "logo": "logos/BIDU.png"
    },
    {
      "symbol": "NIO",
      "name": "NIO",
      "pyth": "0xc8916a12ca17ed0883e37a10c8962370fbd2878a35bb70f6902a0f52be73338c",
      "country": "China",
      "pending": true,
      "feed": "0x0be24f876189314Ef5574fE3E47952524CFe0759",
      "logo": "logos/NIO.png"
    },
    {
      "symbol": "LI",
      "name": "Li Auto",
      "pyth": "0xb10d624c07226d795e9211c9ac95baf43b4a4234ac89cd319e3c72b20de92f99",
      "country": "China",
      "pending": true,
      "feed": "0x67645C5ccbeB943841402D86d4Df0D5F0F48be3F",
      "logo": "logos/LI.png"
    },
    {
      "symbol": "XPEV",
      "name": "XPeng",
      "pyth": "0x9898aa7f08a1ed39d930640595a03f4aaf638c1875763fb94eab70cc0c6d3ed5",
      "country": "China",
      "pending": true,
      "feed": "0x9E2b83e2ED3e637341ADe3f693c25a7D4efd545d",
      "logo": "logos/XPEV.png"
    },
    {
      "symbol": "TME",
      "name": "Tencent Music",
      "pyth": "0x4e9ad694400495593cf8180ffa42490c64a0c721f1c3b2b7ad42c92c7294fd6b",
      "country": "China",
      "pending": true,
      "feed": "0xC3b578a2c68d4E437B6A510ffafbB815E4501D22",
      "logo": "logos/TME.png"
    },
    {
      "symbol": "BILI",
      "name": "Bilibili",
      "pyth": "0x006d336e4cd222530a057ed307c619af1379a4dedfc4839dcbab413df956fbaa",
      "country": "China",
      "pending": true,
      "feed": "0x022a8570F5EDCF06809dFE170CA8aac5861A6344",
      "logo": "logos/BILI.png"
    },
    {
      "symbol": "NTES",
      "name": "NetEase",
      "pyth": "0x664fc65e3f9ffb458e7144959ed8d5c86e923eb7ca283efeadb79bd6c1e4b9ce",
      "country": "China",
      "pending": true,
      "feed": "0x180559560d78B4a9282201Cc9c4bF9F270225527",
      "logo": "logos/NTES.png"
    },
    {
      "symbol": "YUMC",
      "name": "Yum China",
      "pyth": "0x858c14a1577497bd38969a2b30222fde8241b38566435dc69f68f4c6da45cb0e",
      "country": "China",
      "pending": true,
      "feed": "0xe3595253972A8108982eC56E554FFB1aC9e89365",
      "logo": "logos/YUMC.png"
    },
    {
      "symbol": "EDU",
      "name": "New Oriental",
      "pyth": "0x6c409f638d764e93701e076bb41a20a46324f8533401b1b3cc4cd754c04d5dc4",
      "country": "China",
      "pending": true,
      "feed": "0x5b6f4db573C36fD5B900f165Fa2360554Df0BcF0",
      "logo": "logos/EDU.png"
    },
    {
      "symbol": "BEKE",
      "name": "KE Holdings",
      "pyth": "0x7da2dc2834b1c9b412a11f414f2ad14814a976e2c7d613ce3c7635b7bde1e036",
      "country": "China",
      "pending": true,
      "feed": "0x7C5514eeBb6C92b35a7F76C9C8C81b0969162380",
      "logo": "logos/BEKE.png"
    },
    {
      "symbol": "FUTU",
      "name": "Futu",
      "pyth": "0xe6d51d83a2d18919bf5c57604bf3bf581d65efe34d232ba1d0ef33eca03c983f",
      "country": "China",
      "pending": true,
      "feed": "0xDe5D7ac3A53E36d5686095e2EEB3B6A34A56338b",
      "logo": "logos/FUTU.png"
    },
    {
      "symbol": "TCOM",
      "name": "Trip.com",
      "pyth": "0x37527d726792538d5b968b8d5777044cda4413f7814e24978d9a3a9094157c2b",
      "country": "China",
      "pending": true,
      "feed": "0xf299C8A7C5be0F1aabFb831f268A660d66bF6B6C",
      "logo": "logos/TCOM.png"
    },
    {
      "symbol": "FXI",
      "name": "China Large-Cap ETF",
      "pyth": "0x978c107498c949190c0b9bb1ad408eb643b7317ad43539ff43897cab967d7fd3",
      "country": "China",
      "pending": true,
      "type": "ETF",
      "feed": "0x533097Bc4E878115Ad30646b72Dc7C6D71EC33Bd"
    },
    {
      "symbol": "KWEB",
      "name": "China Internet ETF",
      "pyth": "0x8a11c9ba1c8a59571188ff14ca1cc096520eae277de4ff8bc5a6b58939efb096",
      "country": "China",
      "pending": true,
      "type": "ETF",
      "feed": "0x25C984f2b64379E7E33C85560b268c44162FC566"
    },
    {
      "symbol": "MCHI",
      "name": "MSCI China ETF",
      "pyth": "0x33e3853fe3382522aec843bcc3e795bc62ef9d48a47fe2ea7e777926a7ac70f7",
      "country": "China",
      "pending": true,
      "type": "ETF",
      "feed": "0x8fA9c0bD06d54cFA68501ff426De67499379D778"
    },
    {
      "symbol": "GLD",
      "name": "Gold (SPDR Gold ETF)",
      "sourceFeed": "0x470A51258068043bd43dC0a56245625C9fE86eB0",
      "country": "Commodities",
      "type": "ETF",
      "pending": true,
      "feed": "0x83971Fd1fC8E04332b466B8A126E4956B3f22724"
    }
  ],

};
