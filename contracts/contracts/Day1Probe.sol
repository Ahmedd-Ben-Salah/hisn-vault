pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract Day1Probe {
    address public constant HSS = address(0x16b);

    uint256 public pingCount;
    uint256 public lastPingAt;
    uint256 public lastPingArg;
    address public lastPingSender;
    address public lastSchedule;
    int64 public lastScheduleRc;
    uint256 public lastScheduleWhen;
    int64 public lastDeleteRc;
    int64 public lastAssociateRc;

    event Paid(address to, uint256 amount);
    event TokenSent(address token, address to, uint256 amount, bool ok);
    event Scheduled(int64 rc, address schedule, uint256 when, uint256 tries);
    event Pinged(uint256 arg, address sender, uint256 at);
    event Deleted(address schedule, int64 rc);
    event Associated(address token, int64 rc);

    constructor() payable {}

    receive() external payable {}

    function payout(address payable to, uint256 tinybars) external {
        (bool ok,) = to.call{value: tinybars}("");
        require(ok, "payout failed");
        emit Paid(to, tinybars);
    }

    function associate(address token) external returns (int64 rc) {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("associate()"));
        rc = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : int64(-1);
        lastAssociateRc = rc;
        emit Associated(token, rc);
    }

    function sendToken(address token, address to, uint256 amount) external {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        bool good = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        emit TokenSent(token, to, amount, good);
        require(good, "transfer failed");
    }

    function scheduleSelf(uint256 delaySeconds, uint256 gasLimit, uint256 arg) external returns (address) {
        bytes memory data = abi.encodeCall(this.ping, (arg));
        uint256 when = block.timestamp + delaySeconds;
        for (uint256 i = 0; i < 8; i++) {
            (bool ok, bytes memory ret) = HSS.call(
                abi.encodeWithSignature(
                    "scheduleCall(address,uint256,uint256,uint64,bytes)", address(this), when + i, gasLimit, uint64(0), data
                )
            );
            if (ok && ret.length >= 64) {
                (int64 rc, address s) = abi.decode(ret, (int64, address));
                lastScheduleRc = rc;
                if (rc == 22) {
                    lastSchedule = s;
                    lastScheduleWhen = when + i;
                    emit Scheduled(rc, s, when + i, i + 1);
                    return s;
                }
            }
        }
        emit Scheduled(lastScheduleRc, address(0), when, 8);
        return address(0);
    }

    function deleteSched(address s) external returns (int64 rc) {
        (bool ok, bytes memory ret) = HSS.call(abi.encodeWithSignature("deleteSchedule(address)", s));
        rc = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : int64(-1);
        lastDeleteRc = rc;
        emit Deleted(s, rc);
    }

    function ping(uint256 arg) external {
        pingCount++;
        lastPingAt = block.timestamp;
        lastPingArg = arg;
        lastPingSender = msg.sender;
        emit Pinged(arg, msg.sender, block.timestamp);
    }

    function recoverPay(
        address vault,
        address to,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external view returns (address) {
        bytes32 d = keccak256(abi.encode(keccak256("HISN_V1"), block.chainid, vault, uint8(1), to, token, amount, nonce, deadline));
        return ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(d), sig);
    }
}
