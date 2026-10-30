// Network and contract addresses for the app.
// Mainnet addresses come from contracts/deployments/4663.json (deployed 2026-10-30).
window.BELLGUARD_CONFIG = {
  defaultChainId: 4663,
  chains: {
    4663: {
      name: "Robinhood Chain",
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
      mainnet: true,
      deployment: {
        "usdg": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        "calendar": "0x8eeE13759042754C7a524030C09c7628BD580407",
        "vault": "0x4712BAc5Bfd40Fc0bAb7f4270890Bdcd9ba238a8",
        "hook": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4",
        "claims": "0x91d110aACf2FFc7d19F99B1D1E8529928700dDdE",
        "pools": [
          {
            "symbol": "COIN",
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
            "symbol": "MSTR",
            "stock": "0xec262a75e413fAfD0dF80480274532C79D42da09",
            "feed": "0x396118bdFB181e6240E74D243F266B061c0edc3D",
            "key": {
              "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
              "currency1": "0xec262a75e413fAfD0dF80480274532C79D42da09",
              "fee": 3000,
              "tickSpacing": 60,
              "hooks": "0x26ba8a6CA4028DF9C655072F63BC316475542ac4"
            }
          }
        ]
      },
    },
    46630: {
      name: "Robinhood Chain Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      deployment: null, // run contracts/script/DeployTestnetDemo.s.sol and paste demo-46630.json here
    },
  },
};
