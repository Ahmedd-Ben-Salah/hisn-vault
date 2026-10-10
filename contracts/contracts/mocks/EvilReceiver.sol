pragma solidity ^0.8.24;

interface IVaultExec {
    function execute(uint256 id) external;
}

contract EvilReceiver {
    IVaultExec public vault;
    uint256 public targetId;
    uint256 public attempts;
    bool public lastReentryOk;

    function arm(address v, uint256 id) external {
        vault = IVaultExec(v);
        targetId = id;
    }

    receive() external payable {
        attempts++;
        if (address(vault) != address(0) && attempts == 1) {
            (bool ok,) = address(vault).call(abi.encodeCall(IVaultExec.execute, (targetId)));
            lastReentryOk = ok;
        }
    }
}
