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
        "name": "plotResolver_",
        "type": "address",
        "internalType": "contract IPlotResolver"
      },
      {
        "name": "slotResolver_",
        "type": "address",
        "internalType": "contract ISlotResolver"
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
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REASON_CAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REASON_NO_FARMER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REASON_PLOT_EXPIRED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REASON_UNVERIFIED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "REASON_ZONE_MISMATCH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "attest",
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
            "name": "tempC",
            "type": "uint8",
            "internalType": "uint8"
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
        "name": "sigs",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "attestations",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
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
        "name": "seasonLabel",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "eligibleUnits",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "perUnit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reservedAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "attestedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "claimDeadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimHeld",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimWindow",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enroll",
    "inputs": [
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
            "name": "tempC",
            "type": "uint8",
            "internalType": "uint8"
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
    "name": "getRoleAdmin",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "grantRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
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
    "name": "isSigner",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
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
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "seasonLabel",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "farmer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "plotRegistry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "slotExpiry",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "plotResolver",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPlotResolver"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "plotSettlements",
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
    "outputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ReliefPool.PlotStatus"
      },
      {
        "name": "holdReason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "plots",
    "inputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
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
        "name": "enrolled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reindex",
    "inputs": [
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "renounceRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "callerConfirmation",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reserved",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revokeRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setClaimWindow",
    "inputs": [
      {
        "name": "window",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSigners",
    "inputs": [
      {
        "name": "newSigners",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "threshold_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTierAmount",
    "inputs": [
      {
        "name": "perilId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "speciesId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "amountPerUnit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setUnitCap",
    "inputs": [
      {
        "name": "level",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "cap",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "plotLabels",
        "type": "string[]",
        "internalType": "string[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "signerThreshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "signers",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "signersCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "slotResolver",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISlotResolver"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sweep",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tierAmounts",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "triggerDigest",
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unitCap",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unitsByZoneSpecies",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unitsPaid",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
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
            "name": "tempC",
            "type": "uint8",
            "internalType": "uint8"
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
    "name": "ClaimWindowSet",
    "inputs": [
      {
        "name": "window",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
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
    "name": "EIP712DomainChanged",
    "inputs": [],
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
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SignersUpdated",
    "inputs": [
      {
        "name": "signers",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "threshold",
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
    "type": "event",
    "name": "TierAmountSet",
    "inputs": [
      {
        "name": "perilId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "speciesId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "tier",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "amountPerUnit",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UnitCapSet",
    "inputs": [
      {
        "name": "level",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "cap",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "neededRole",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
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
    "name": "ClaimWindowActive",
    "inputs": [
      {
        "name": "claimDeadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "nowTs",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ClaimWindowElapsed",
    "inputs": [
      {
        "name": "claimDeadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "nowTs",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "DuplicateSigner",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignerConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoEligibleUnits",
    "inputs": [
      {
        "name": "zoneId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "speciesId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotHeld",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "PlotNotEnrolled",
    "inputs": [
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StillIneligible",
    "inputs": [
      {
        "name": "eventId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "reason",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
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
  },
  {
    "type": "error",
    "name": "TierAmountNotSet",
    "inputs": [
      {
        "name": "perilId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "speciesId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownEvent",
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
    "name": "UnknownPlot",
    "inputs": [
      {
        "name": "plotLabel",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "WindowNotElapsed",
    "inputs": [
      {
        "name": "windowEnd",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "nowTs",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
