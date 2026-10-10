# Day-1 results

Each run appends its own section. Nothing here is edited by hand afterwards.

## Test 1: vault pays out HBAR: PASS (2026-10-05T23:13:42.857Z)

- probe 0xFEB56C5C8C8AD0e65549e729FeDA85408AB9196a (0.0.10880018), balance after deploy 2000000000 tinybar
- payout 1 HBAR to 0xF4C9E925D3029D59E05a4AA315AbF82B9642831f: recipient balance moved by 100000000 tinybar
- admin key shown by the mirror node: {"_type":"ProtobufEncoded","key":"0a051892889805"}
- gas used 32532
- payout tx https://hashscan.io/testnet/transaction/0x1b955e5b8a0cde4c97c0a4041e480a39652041b3da485d1e4905d37db22e31ea

## Test 3: vault schedules its own call: PASS (2026-10-05T23:15:38.172Z)

- scheduleCall rc 22, schedule 0x0000000000000000000000000000000000A60419 (0.0.10880025), when 1791242089
- scheduling tx gas used 1481971 https://hashscan.io/testnet/transaction/0xddd3263b3f7c9668574fd7d336cde2e9b0eb58e918b384212add6f161c3ec45f
- probe HBAR change -9264875 tinybar
- mirror schedule: executed 1791242089.049551104, deleted false
- ping ran at 1791242088 (chosen second 1791242089, offset -1 s)
- msg.sender inside the scheduled call 0xFEB56C5C8C8AD0e65549e729FeDA85408AB9196a
- ping fired: true

## Test 4: deleteSchedule cancels: PASS (2026-10-05T23:17:38.056Z)

- scheduleCall rc 22, schedule 0x0000000000000000000000000000000000a60439 (0.0.10880057), when 1791242209
- scheduling tx gas used 1447771 https://hashscan.io/testnet/transaction/0xd72f03b130d19788da4deb7194d311d4b3b18b10b71d4ca372e79847052255ae
- deleteSchedule rc 22 tx https://hashscan.io/testnet/transaction/0xb45222082fe4735ce220adf0c4020ba5a9c8616f1f331f6c3da65d254444fb3b
- probe HBAR change 0 tinybar
- mirror schedule: executed no, deleted true
- ping fired after delete: false

## Test 5: device signature accepted by ecrecover on testnet: PASS (2026-10-05T23:17:38.973Z)

- signature source: test vector (ESP32 not yet connected)
- digest 0xeb3821f52de8fa98e01f4ce22c182653bb4cf8161022e052000cefd6f891e505 (bytes 32)
- recovered 0x2c7536E3605D9C16a7a3D7b1898e529396a65c23, expected 0x2c7536E3605D9C16a7a3D7b1898e529396a65c23
- one-byte change recovers 0x23c0a2bEF0bb3b10D0007F71d4d04EAB7ba30f60

## Test 6 (HCS public log): PASS (2026-10-05T23:18:03.657Z)

- Topic 0.0.10880091 with no submit key: https://hashscan.io/testnet/topic/0.0.10880091
- Message 1 submitted, tx 0.0.10876213@1791242263.480962070
- Message 2 submitted 11 s later, tx 0.0.10876213@1791242272.518366477
- Message 1: sequence 1, consensus 1791242266.949656104, decoded type REQUEST
- Message 2: sequence 2, consensus 1791242278.288233104, decoded type PROPOSED
- Consensus gap 11.339 s (expected about 10 s)
- Both visible on the mirror node after 4 s of polling from the second submit
- Sender clock to consensus: message 1 0.39 s

## Test 2: vault holds and sends USDC: PASS (2026-10-06T09:58:42.804Z)

Run with tUSDC `0.0.10885973`, our fixed-supply testnet stand-in for USDC: Circle's faucet never delivered Circle testnet USDC (`0.0.429274`) on Hedera.

- associate() rc 22 tx https://hashscan.io/testnet/transaction/0x0daa1baadd8d4b4e6296dfbabb41b747d4baad3a51f29b03c00b640aad2001a9
- relayer USDC balance 1000000000000
- deposit 2 USDC tx https://hashscan.io/testnet/transaction/0x5d9059563dae766d218d7fc8132f078042fe3c331f41a3c57ce255fc4dfc9aec; probe balance 2000000
- send 1 USDC to 0xF4C9E925D3029D59E05a4AA315AbF82B9642831f: moved 1000000 tx https://hashscan.io/testnet/transaction/0xc6845ab067d625d62476f06066c9f2be6477e80accd3ca06f7483c08cb2f1e63
