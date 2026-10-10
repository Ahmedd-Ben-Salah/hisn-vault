pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    mapping(address => bool) public associated;
    bool public requireAssociation;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setRequireAssociation(bool v) external {
        requireAssociation = v;
    }

    function associate() external returns (int64) {
        associated[msg.sender] = true;
        return int64(22);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (requireAssociation && to != address(0) && !associated[to]) revert("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
        super._update(from, to, value);
    }
}
