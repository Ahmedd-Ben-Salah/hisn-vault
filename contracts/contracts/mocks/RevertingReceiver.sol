pragma solidity ^0.8.24;

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}
