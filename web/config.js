// Network and contract addresses for the app.
// Mainnet addresses come from contracts/deployments/4663.json (deployed 2026-10-30).
window.BELLGUARD_CONFIG = {
  defaultChainId: 4663,
  chains: {
    4663: {
      name: "Mainnet",
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      relay: "/api/rpc?chain=4663",
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
      mainnet: true,
      deployment: {
        "positionManager": "0x58daec3116aae6d93017baaea7749052e8a04fa7",
        "poolManager": "0x8366a39CC670B4001A1121B8F6A443A643e40951",
        "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        "stateView": "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
        "usdg": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        "calendar": "0x8eeE13759042754C7a524030C09c7628BD580407",
        "vault": "0x4712BAc5Bfd40Fc0bAb7f4270890Bdcd9ba238a8",
        "hook": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4",
        "claims": "0x91d110aACf2FFc7d19F99B1D1E8529928700dDdE",
        "pools": [
          {
            "symbol": "COIN", "name": "Coinbase", "logo": "logos/COIN.png",
            "stock": "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
            "feed": "0xA3a468A452940B7D6b69991207B508c609a98Ef2",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "MSTR", "name": "Strategy", "logo": "logos/MSTR.png",
            "stock": "0xec262a75e413fAfD0dF80480274532C79D42da09",
            "feed": "0x396118bdFB181e6240E74D243F266B061c0edc3D",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xec262a75e413fAfD0dF80480274532C79D42da09",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "TSLA", "name": "Tesla", "logo": "logos/TSLA.png",
            "stock": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
            "feed": "0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6",
            "key": {
              "currency0": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "NVDA", "name": "NVIDIA", "logo": "logos/NVDA.png",
            "stock": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
            "feed": "0xCF169363636D73dbBf77733629CB38919d14232d",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "AAPL", "name": "Apple", "logo": "logos/AAPL.png",
            "stock": "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
            "feed": "0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "AMZN", "name": "Amazon", "logo": "logos/AMZN.png",
            "stock": "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
            "feed": "0x9244830430bC7D9C9A48dd47603F24AD61f7c56e",
            "key": {
              "currency0": "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "GOOGL", "name": "Alphabet", "logo": "logos/GOOGL.png",
            "stock": "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
            "feed": "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
            "key": {
              "currency0": "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "META", "name": "Meta", "logo": "logos/META.png",
            "stock": "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
            "feed": "0x5cBC53D382E56cBb223f118CF8Eefb6c9c2759f5",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "MSFT", "name": "Microsoft", "logo": "logos/MSFT.png",
            "stock": "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
            "feed": "0xaD6D88eab22aa4867Efe807a5311Ed64962f740D",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "AMD", "name": "AMD", "logo": "logos/AMD.png",
            "stock": "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
            "feed": "0xF6d57763DFa625F4A413485261Ab2E71Ff4304CF",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "PLTR", "name": "Palantir", "logo": "logos/PLTR.png",
            "stock": "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
            "feed": "0x8cd1DFC0fc61fcA55FA77b37e008A90f13364Fce",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "SPY", "name": "S&P 500 ETF", "type": "ETF",
            "stock": "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
            "feed": "0xa68CA83408bE3f78d1c58a82081c619e9d21486d",
            "key": {
              "currency0": "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "QQQ", "name": "Nasdaq-100 ETF", "type": "ETF",
            "stock": "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
            "feed": "0x41ed2c58611790af0760e31e80Bb427e4e83D603",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "GME", "name": "GameStop", "logo": "logos/GME.png",
            "stock": "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
            "feed": "0x42A4652D447A5B0bccF3B265bE8530b85A33b3A2",
            "key": {
              "currency0": "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "CRCL", "name": "Circle",
            "stock": "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
            "feed": "0x025Ba3B3569Ca7d15Da7BFC1648F13F06A072851",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "MU", "name": "Micron", "logo": "logos/MU.png",
            "stock": "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
            "feed": "0x5b40F4E78FA58B60a4F59b8cc8cB8d2Fb0690467",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "CRWV", "name": "CoreWeave",
            "stock": "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
            "feed": "0x288b837A17fED1aa00c1df832ef79D0C77336c10",
            "key": {
              "currency0": "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "RKLB", "name": "Rocket Lab", "logo": "logos/RKLB.png",
            "stock": "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
            "feed": "0x955c60932E517B36be137Eee78E65343cBFC9D29",
            "key": {
              "currency0": "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "IONQ", "name": "IonQ", "logo": "logos/IONQ.png",
            "stock": "0x558378E000D634A36593E338eBacdd6207640EfE",
            "feed": "0x926D7D95E554D1e671EB2C0d238fe37a2C23A64E",
            "key": {
              "currency0": "0x558378E000D634A36593E338eBacdd6207640EfE",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "SPCX", "name": "SpaceX", "logo": "logos/SPCX.png",
            "stock": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
            "feed": "0x42a95341ff361e81fd934F39943c5C98F6991844",
            "key": {
              "currency0": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "TSM", "name": "TSMC", "logo": "logos/TSM.png",
            "stock": "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
            "feed": "0xB48D6D5729Ca032ca43729F4b605bBf9f257A84d",
            "key": {
              "currency0": "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
              "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          },
          {
            "symbol": "ORCL", "name": "Oracle", "logo": "logos/ORCL.png",
            "stock": "0xb0992820E760d836549ba69BC7598b4af75dEE03",
            "feed": "0x2a07f8d87d369Bd8Bc36472337ae02d512a7b5e5",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xb0992820E760d836549ba69BC7598b4af75dEE03",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          }
        ]
      },
    },
    46630: {
      name: "Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      relay: "/api/rpc?chain=46630",
      deployment: null, // run contracts/script/DeployTestnetDemo.s.sol and paste demo-46630.json here
    },
  },
};
