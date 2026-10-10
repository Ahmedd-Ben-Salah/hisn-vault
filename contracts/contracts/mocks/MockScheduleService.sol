pragma solidity ^0.8.24;

contract MockScheduleService {
    struct Sched {
        address to;
        uint256 when;
        uint256 gasLimit;
        bytes data;
        bool deleted;
        bool fired;
    }

    mapping(address => Sched) public scheds;
    mapping(uint256 => uint256) public usedAt;
    address[] public all;
    uint256 public counter;
    bool public failAll;
    uint256 public busySecond;

    function setFailAll(bool v) external {
        failAll = v;
    }

    function setBusySecond(uint256 s) external {
        busySecond = s;
    }

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64, bytes memory callData)
        external
        returns (int64, address)
    {
        if (failAll) return (int64(21), address(0));
        if (expirySecond == busySecond) return (int64(370), address(0));
        counter++;
        address s = address(uint160(0x5c4ed000000 + counter));
        scheds[s] = Sched(to, expirySecond, gasLimit, callData, false, false);
        all.push(s);
        return (int64(22), s);
    }

    function deleteSchedule(address s) external returns (int64) {
        if (scheds[s].to == address(0)) return int64(201);
        scheds[s].deleted = true;
        return int64(22);
    }

    function hasScheduleCapacity(uint256, uint256) external view returns (bool) {
        return !failAll;
    }

    function count() external view returns (uint256) {
        return all.length;
    }

    function fire(address s) external returns (bool ok, bytes memory ret) {
        Sched storage x = scheds[s];
        require(x.to != address(0), "no schedule");
        require(!x.deleted, "deleted");
        require(!x.fired, "fired");
        require(block.timestamp >= x.when, "too early");
        x.fired = true;
        (ok, ret) = x.to.call{gas: x.gasLimit}(x.data);
    }
}
