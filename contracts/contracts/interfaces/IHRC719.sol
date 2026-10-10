pragma solidity ^0.8.24;

interface IHRC719 {
    function associate() external returns (int64 responseCode);

    function dissociate() external returns (int64 responseCode);

    function isAssociated() external view returns (bool);
}
