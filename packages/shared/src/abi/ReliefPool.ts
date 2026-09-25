export const ReliefPoolAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "jpyc_",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "humans_",
        "type": "address",
        "internalType": "contract IHumanRegistry"
      },
      {
        "name": "branchRegistry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "admin_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "admin",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "attest",
    "inputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IReliefPool.Trigger",
        "components": [
          {
            "name": "zoneId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "speciesId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "perilId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tier",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "seasonLabel",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "firedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "index",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "dataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "branchRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimHeld",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "enroll",
    "inputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "eventIdOf",
    "inputs": [
      {
        "name": "t",
        "type": "tuple",
        "internalType": "struct IReliefPool.Trigger",
        "components": [
          {
            "name": "zoneId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "speciesId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "perilId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tier",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "seasonLabel",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "firedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "index",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "dataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "humans",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHumanRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jpyc",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "payoutTarget",
    "inputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "reindex",
    "inputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "string[]",
        "internalType": "string[]"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "sweep",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "Attested",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "t",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct IReliefPool.Trigger",
        "components": [
          {
            "name": "zoneId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "speciesId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "perilId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "tier",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "seasonLabel",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "firedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "index",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "dataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "eligibleUnits",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "perUnit",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "signers",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "farmer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Donated",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "memo",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Enrolled",
    "inputs": [
      {
        "name": "plotLabel",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "zoneId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "speciesId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Held",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paid",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "farmer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nullifier",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Swept",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyAttested",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadSignatures",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ThresholdNotMet",
    "inputs": [
      {
        "name": "index",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "threshold",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  }
] as const;
