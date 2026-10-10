pragma solidity ^0.8.24;

interface IHederaScheduleService {
    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress);

    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);

    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool);
}
