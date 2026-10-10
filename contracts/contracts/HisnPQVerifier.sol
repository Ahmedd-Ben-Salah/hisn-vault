// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stateless verifier for Hisn's hash-based (post-quantum) one-time signatures.
/// WOTS with w = 16 (64 message digits + 3 checksum digits = 67 hash chains), leaves in a Merkle tree.
/// Security rests only on Keccak-256; Shor's algorithm does not apply. Byte layouts match
/// shared/src/pq.ts and firmware/lib/hisn_crypto/src/hisn_pq.c. Simplified XMSS-style scheme, not audited.
contract HisnPQVerifier {
    bytes32 public constant PQ_TAG = keccak256("HISN_PQ_V1");
    uint256 internal constant PQ_LEN = 67;

    /// @param pq abi.encode(uint32 leaf, bytes32[67] chains, bytes32[] path)
    /// @return h the Merkle root the signature leads to
    /// @return leaf the one-time key index
    /// @return height the Merkle path length
    function check(uint256 chainId, address vault, bytes32 digest, bytes calldata pq)
        external
        pure
        returns (bytes32 h, uint32 leaf, uint256 height)
    {
        bytes32[67] memory chains;
        bytes32[] memory path;
        (leaf, chains, path) = abi.decode(pq, (uint32, bytes32[67], bytes32[]));
        height = path.length;
        bytes32 m = keccak256(abi.encodePacked(PQ_TAG, chainId, vault, leaf, digest));
        uint256 csum;
        bytes memory ends = new bytes(1 + 32 * PQ_LEN);
        ends[0] = 0x02;
        bytes memory step = new bytes(39); // 0x01 || leaf[4] || i[1] || j[1] || x[32]
        assembly {
            mstore8(add(step, 32), 0x01)
            mstore8(add(step, 33), shr(24, leaf))
            mstore8(add(step, 34), shr(16, leaf))
            mstore8(add(step, 35), shr(8, leaf))
            mstore8(add(step, 36), leaf)
        }
        for (uint256 i = 0; i < PQ_LEN; i++) {
            uint256 digit;
            if (i < 64) {
                digit = (uint256(m) >> (252 - 4 * i)) & 15;
                csum += 15 - digit;
            } else {
                digit = (csum >> (4 * (66 - i))) & 15;
            }
            bytes32 x = chains[i];
            assembly {
                let base := add(step, 32)
                mstore8(add(base, 5), i)
                for { let j := digit } lt(j, 15) { j := add(j, 1) } {
                    mstore8(add(base, 6), j)
                    mstore(add(base, 7), x)
                    x := keccak256(base, 39)
                }
                mstore(add(add(ends, 33), mul(i, 32)), x)
            }
        }
        h = keccak256(ends);
        uint256 idx = leaf;
        for (uint256 k = 0; k < path.length; k++) {
            h = idx & 1 == 1
                ? keccak256(abi.encodePacked(uint8(3), path[k], h))
                : keccak256(abi.encodePacked(uint8(3), h, path[k]));
            idx >>= 1;
        }
    }
}
