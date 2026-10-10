pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHederaScheduleService} from "./interfaces/IHederaScheduleService.sol";
import {HisnPQVerifier} from "./HisnPQVerifier.sol";

contract HisnVault is ReentrancyGuard {
    enum Tier { INSTANT, WAIT, APPROVAL }
    enum Status { NONE, PENDING, EXECUTED, VETOED, CANCELLED, EXPIRED }
    enum Role { NONE, PUCK, GUARDIAN, WATCHER, AGENT }
    enum ChangeKind {
        ADD_PAYEE,
        REMOVE_PAYEE,
        SET_LIMITS,
        SET_COOLOFF,
        SET_AGENT,
        ADD_GUARDIAN,
        REMOVE_GUARDIAN,
        ADD_WATCHER,
        REMOVE_WATCHER,
        UNFREEZE,
        RECOVER_PUCK,
        SET_PQ_ROOT
    }

    struct Limits {
        uint128 instantMax;
        uint128 waitMax;
        uint128 dailyCap;
        uint128 agentDailyMax;
    }

    struct Immutables {
        uint32 minCoolOff;
        uint32 settingsDelay;
        uint32 recoveryDelay;
        uint32 approvalWindow;
        uint32 freezeMax;
        uint32 probation;
        uint256 gasReserve;
        uint256 execGas;
    }

    struct Payment {
        address to;
        address token;
        uint128 amount;
        uint64 proposedAt;
        uint64 confirmFrom;
        uint64 releaseAt;
        uint64 expiresAt;
        uint32 epoch;
        Tier tier;
        Status status;
        bool confirmed;
        address schedule;
    }

    struct Change {
        ChangeKind kind;
        bytes data;
        uint64 proposedAt;
        uint64 readyAt;
        uint64 expiresAt;
        address proposer;
        address approver;
        uint32 keyEpoch;
        Status status;
    }

    uint8 internal constant A_PAY = 1;
    uint8 internal constant A_AGENT_PAY = 2;
    uint8 internal constant A_VETO = 3;
    uint8 internal constant A_CANCEL = 4;
    uint8 internal constant A_APPROVE = 5;
    uint8 internal constant A_FREEZE = 6;
    uint8 internal constant A_CHANGE = 7;
    uint8 internal constant A_CHANGE_APPROVE = 8;
    uint8 internal constant A_CHANGE_VETO = 9;
    uint8 internal constant A_RECONFIRM = 11;
    uint8 internal constant A_RENEW_FREEZE = 12;

    bytes32 public constant TAG = keccak256("HISN_V1");
    uint256 public constant MAX_PENDING = 5;
    uint256 public constant MAX_DEADLINE = 600;
    uint256 public constant MAX_GUARDIANS = 4;
    uint256 public constant MAX_WATCHERS = 4;
    uint256 public constant SCHEDULE_SLACK = 5;
    uint256 public constant SCHEDULE_TRIES = 8;
    int64 internal constant HEDERA_SUCCESS = 22;
    address public constant SCHEDULE_SERVICE = address(0x16b);


    address public immutable USDC;
    uint32 public immutable MIN_COOLOFF;
    uint32 public immutable SETTINGS_DELAY;
    uint32 public immutable RECOVERY_DELAY;
    uint32 public immutable APPROVAL_WINDOW;
    uint32 public immutable FREEZE_MAX;
    uint32 public immutable PROBATION;
    uint256 public immutable GAS_RESERVE;
    uint256 public immutable EXEC_GAS;
    uint8 public immutable PQ_HEIGHT;
    /// Stateless checker for the puck's hash-based (post-quantum) signatures. See HisnPQVerifier.sol.
    HisnPQVerifier public immutable PQ_VERIFIER;

    address public puck;
    address[] internal guardianList;
    address[] internal watcherList;
    address public agent;
    uint32 public coolOff;
    uint64 public frozenUntil;
    address public lastFreezer;
    uint32 public epoch;
    uint32 public keyEpoch;

    /// Merkle root of the puck's hash-based keys. When set, every puck action that moves money or changes
    /// settings needs a hash-based signature as well as the ECDSA one.
    bytes32 public pqRoot;
    uint32 public pqUsed;
    mapping(bytes32 => mapping(uint256 => bool)) public pqLeafUsed;
    /// A key that froze the vault cannot freeze it again until this time (stops a rogue key from
    /// freezing forever and wiping the owner's request to remove it).
    mapping(address => uint64) public freezeCooldownUntil;

    mapping(address => Role) public roleOf;
    mapping(address => Limits) public limits;
    mapping(address => uint64) public payeeSince;
    address[] internal payeeList;

    mapping(address => mapping(uint256 => uint256)) public instantSpent;
    mapping(address => mapping(uint256 => uint256)) public waitQueued;
    mapping(address => mapping(uint256 => uint256)) public agentSpent;
    mapping(bytes32 => bool) public usedDigest;

    uint256 public paymentCount;
    mapping(uint256 => Payment) internal payments;
    uint256[] internal pendingIds;

    uint256 public changeCount;
    mapping(uint256 => Change) internal changes;

    event Proposed(uint256 indexed id, address indexed to, address token, uint256 amount, Tier tier, uint64 releaseAt, uint64 confirmFrom);
    event Confirmed(uint256 indexed id, address indexed by, address schedule);
    event Executed(uint256 indexed id, address indexed to, address token, uint256 amount, address caller);
    event Vetoed(uint256 indexed id, address indexed by);
    event Cancelled(uint256 indexed id);
    event Expired(uint256 indexed id);
    event AgentPaid(address indexed to, address token, uint256 amount);
    event ScheduleFailed(uint256 indexed id);
    event ScheduleDeleted(uint256 indexed id, address schedule, int64 responseCode);
    event Frozen(address indexed by, uint32 newEpoch, uint64 until);
    event FreezeRenewed(address indexed by, uint64 until);
    event Unfrozen();
    event ChangeProposed(uint256 indexed id, ChangeKind kind, bytes data, uint64 readyAt, address proposer);
    event ChangeApproved(uint256 indexed id, address indexed by);
    event ChangeVetoed(uint256 indexed id, address indexed by);
    event ChangeExecuted(uint256 indexed id, ChangeKind kind);
    event Associated(address indexed token, int64 responseCode);
    event Deposited(address indexed from, uint256 amount);
    event PqRootSet(bytes32 root, uint8 height);
    event PqSigned(uint32 leaf, uint32 used);

    error BadSignature();
    error Expired_();
    error DeadlineTooFar();
    error Replayed();
    error IsFrozen();
    error NotFrozen();
    error BadToken();
    error ZeroAmount();
    error NotPending();
    error TooEarly();
    error NotConfirmed();
    error AlreadyConfirmed();
    error WrongTier();
    error OldEpoch();
    error NotPuck();
    error NotGuardian();
    error NotAllowed();
    error NotPayee();
    error OnProbation();
    error OverAgentLimit();
    error TooManyPending();
    error BelowGasReserve();
    error TransferFailed();
    error BelowMinCoolOff();
    error LastGuardian();
    error KeyAlreadyUsed();
    error SameApprover();
    error NotReady();
    error BadData();
    error TooManyKeys();
    error UnknownKey();
    error ChangeDead();
    error NoAgent();
    error SameFreezer();
    error PqRequired();
    error PqBadSignature();
    error PqLeafUsed();
    error FreezeCooldown();

    constructor(
        address puck_,
        address[] memory guardians_,
        address[] memory watchers_,
        address agent_,
        address usdc_,
        uint32 coolOff_,
        Immutables memory im_,
        Limits memory hbarLimits_,
        Limits memory usdcLimits_,
        address[] memory payees_,
        bytes32 pqRoot_,
        uint8 pqHeight_,
        address pqVerifier_
    ) payable {
        USDC = usdc_;
        MIN_COOLOFF = im_.minCoolOff;
        SETTINGS_DELAY = im_.settingsDelay;
        RECOVERY_DELAY = im_.recoveryDelay;
        APPROVAL_WINDOW = im_.approvalWindow;
        FREEZE_MAX = im_.freezeMax;
        PROBATION = im_.probation;
        GAS_RESERVE = im_.gasReserve;
        EXEC_GAS = im_.execGas;
        if (pqHeight_ == 0 || pqHeight_ > 16) revert BadData();
        PQ_HEIGHT = pqHeight_;
        PQ_VERIFIER = HisnPQVerifier(pqVerifier_);
        if (pqRoot_ != bytes32(0) && pqVerifier_ == address(0)) revert BadData();
        if (pqRoot_ != bytes32(0)) {
            pqRoot = pqRoot_;
            emit PqRootSet(pqRoot_, pqHeight_);
        }

        if (coolOff_ < im_.minCoolOff) revert BelowMinCoolOff();
        if (guardians_.length == 0) revert LastGuardian();
        if (guardians_.length > MAX_GUARDIANS || watchers_.length > MAX_WATCHERS) revert TooManyKeys();
        if (usdc_ == address(0)) revert BadToken();

        _addKey(puck_, Role.PUCK);
        puck = puck_;
        for (uint256 i = 0; i < guardians_.length; i++) {
            _addKey(guardians_[i], Role.GUARDIAN);
            guardianList.push(guardians_[i]);
        }
        for (uint256 i = 0; i < watchers_.length; i++) {
            _addKey(watchers_[i], Role.WATCHER);
            watcherList.push(watchers_[i]);
        }
        if (agent_ != address(0)) {
            _addKey(agent_, Role.AGENT);
            agent = agent_;
        }
        coolOff = coolOff_;
        limits[address(0)] = hbarLimits_;
        limits[usdc_] = usdcLimits_;
        for (uint256 i = 0; i < payees_.length; i++) {
            _addPayee(payees_[i]);
        }
        if (msg.value > 0) emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function associateToken() external returns (int64 rc) {
        (bool ok, bytes memory ret) = USDC.call(abi.encodeWithSignature("associate()"));
        rc = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : int64(-1);
        emit Associated(USDC, rc);
    }

    function propose(address to, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 id)
    {
        return _propose(to, token, amount, nonce, deadline, sig, msg.data[0:0]);
    }

    /// Same as `propose`, plus the puck's hash-based signature over the same digest.
    function proposePQ(
        address to,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        bytes calldata pq
    ) external nonReentrant returns (uint256 id) {
        return _propose(to, token, amount, nonce, deadline, sig, pq);
    }

    function _propose(
        address to,
        address token,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        bytes calldata pq
    ) internal returns (uint256 id) {
        _notFrozen();
        _checkDeadline(deadline);
        _checkToken(token);
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert BadData();
        if (roleOf[to] != Role.NONE || to == address(0) || to == address(this)) revert NotAllowed();
        bytes32 d = _digest(A_PAY, abi.encode(to, token, amount, nonce, deadline));
        _useDigest(d);
        if (_signer(d, sig) != puck) revert BadSignature();
        _pqCheck(d, pq);

        Tier tier = tierFor(to, token, amount);
        uint256 today = _today();
        id = ++paymentCount;
        Payment storage p = payments[id];
        p.to = to;
        p.token = token;
        p.amount = uint128(amount);
        p.proposedAt = uint64(block.timestamp);
        p.epoch = epoch;
        p.tier = tier;

        if (tier == Tier.INSTANT) {
            instantSpent[token][today] += amount;
            p.releaseAt = uint64(block.timestamp);
            p.confirmFrom = uint64(block.timestamp);
            p.expiresAt = uint64(block.timestamp);
            p.confirmed = true;
            p.status = Status.EXECUTED;
            emit Proposed(id, to, token, amount, tier, p.releaseAt, p.confirmFrom);
            _pay(to, token, amount);
            emit Executed(id, to, token, amount, msg.sender);
            return id;
        }

        _sweep();
        if (pendingIds.length >= MAX_PENDING) revert TooManyPending();
        if (tier == Tier.WAIT) waitQueued[token][today] += amount;
        p.status = Status.PENDING;
        p.releaseAt = uint64(block.timestamp + coolOff);
        p.confirmFrom = tier == Tier.WAIT ? uint64(block.timestamp + coolOff / 2) : uint64(block.timestamp);
        p.expiresAt = p.releaseAt + APPROVAL_WINDOW;
        pendingIds.push(id);
        emit Proposed(id, to, token, amount, tier, p.releaseAt, p.confirmFrom);
    }

    function reconfirm(uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig) external nonReentrant {
        _reconfirm(id, nonce, deadline, sig, msg.data[0:0]);
    }

    function reconfirmPQ(uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig, bytes calldata pq)
        external
        nonReentrant
    {
        _reconfirm(id, nonce, deadline, sig, pq);
    }

    function _reconfirm(uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig, bytes calldata pq) internal {
        _notFrozen();
        _checkDeadline(deadline);
        bytes32 d = _digest(A_RECONFIRM, abi.encode(id, nonce, deadline));
        _useDigest(d);
        if (_signer(d, sig) != puck) revert BadSignature();
        _pqCheck(d, pq);
        Payment storage p = _live(id);
        if (p.tier != Tier.WAIT) revert WrongTier();
        if (p.confirmed) revert AlreadyConfirmed();
        if (block.timestamp < p.confirmFrom) revert TooEarly();
        _confirm(id, p, msg.sender);
    }

    function approve(uint256 id, bytes calldata sig) external nonReentrant {
        _notFrozen();
        address s = _signer(_digest(A_APPROVE, abi.encode(id)), sig);
        if (roleOf[s] != Role.GUARDIAN) revert NotGuardian();
        Payment storage p = _live(id);
        if (p.tier != Tier.APPROVAL) revert WrongTier();
        if (p.confirmed) revert AlreadyConfirmed();
        _confirm(id, p, s);
    }

    function execute(uint256 id) external nonReentrant {
        _notFrozen();
        Payment storage p = _live(id);
        if (!p.confirmed) revert NotConfirmed();
        if (block.timestamp < p.releaseAt) revert TooEarly();
        _release(id, p);
    }

    function veto(uint256 id, bytes calldata sig) external nonReentrant {
        address s = _signer(_digest(A_VETO, abi.encode(id)), sig);
        Role r = roleOf[s];
        if (r != Role.GUARDIAN && r != Role.WATCHER) revert NotGuardian();
        Payment storage p = payments[id];
        if (p.status != Status.PENDING) revert NotPending();
        _close(id, p, Status.VETOED);
        emit Vetoed(id, s);
    }

    function cancel(uint256 id, bytes calldata sig) external nonReentrant {
        if (_signer(_digest(A_CANCEL, abi.encode(id)), sig) != puck) revert BadSignature();
        Payment storage p = payments[id];
        if (p.status != Status.PENDING) revert NotPending();
        _close(id, p, Status.CANCELLED);
        emit Cancelled(id);
    }

    function expire(uint256 id) external {
        Payment storage p = payments[id];
        if (p.status != Status.PENDING) revert NotPending();
        if (block.timestamp <= p.expiresAt && p.epoch == epoch) revert TooEarly();
        _close(id, p, Status.EXPIRED);
        emit Expired(id);
    }

    function agentPay(address to, address token, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        if (agent == address(0)) revert NoAgent();
        _notFrozen();
        _checkDeadline(deadline);
        _checkToken(token);
        if (amount == 0) revert ZeroAmount();
        bytes32 d = _digest(A_AGENT_PAY, abi.encode(to, token, amount, nonce, deadline));
        _useDigest(d);
        if (_signer(d, sig) != agent) revert BadSignature();
        uint64 since = payeeSince[to];
        if (since == 0) revert NotPayee();
        if (block.timestamp < uint256(since) + PROBATION) revert OnProbation();
        uint256 today = _today();
        if (_window(agentSpent[token], today) + amount > limits[token].agentDailyMax) revert OverAgentLimit();
        agentSpent[token][today] += amount;
        _pay(to, token, amount);
        emit AgentPaid(to, token, amount);
    }

    function freeze(bytes calldata sig) external {
        if (_isFrozen()) revert IsFrozen();
        address s = _signer(_digest(A_FREEZE, abi.encode(uint256(epoch))), sig);
        Role r = roleOf[s];
        if (r != Role.PUCK && r != Role.GUARDIAN && r != Role.WATCHER) revert NotAllowed();
        if (r != Role.PUCK && block.timestamp < freezeCooldownUntil[s]) revert FreezeCooldown();
        frozenUntil = uint64(block.timestamp + FREEZE_MAX);
        // Long enough for the owner to remove this key (REMOVE_GUARDIAN waits up to 2 * RECOVERY_DELAY).
        freezeCooldownUntil[s] = uint64(
            block.timestamp + FREEZE_MAX + 2 * uint256(RECOVERY_DELAY) + APPROVAL_WINDOW
        );
        lastFreezer = s;
        epoch += 1;
        keyEpoch += 1;
        uint256 n = pendingIds.length;
        while (n > 0) {
            uint256 id = pendingIds[n - 1];
            _close(id, payments[id], Status.CANCELLED);
            emit Cancelled(id);
            n = pendingIds.length;
        }
        emit Frozen(s, epoch, frozenUntil);
    }

    function renewFreeze(bytes calldata sig) external {
        if (!_isFrozen()) revert NotFrozen();
        address s = _signer(_digest(A_RENEW_FREEZE, abi.encode(uint256(epoch), uint256(frozenUntil))), sig);
        Role r = roleOf[s];
        if (r != Role.PUCK && r != Role.GUARDIAN && r != Role.WATCHER) revert NotAllowed();
        if (s == lastFreezer) revert SameFreezer();
        frozenUntil = uint64(block.timestamp + FREEZE_MAX);
        lastFreezer = s;
        emit FreezeRenewed(s, frozenUntil);
    }

    function proposeChange(ChangeKind kind, bytes calldata data, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 id)
    {
        return _proposeChange(kind, data, nonce, deadline, sig, msg.data[0:0]);
    }

    function proposeChangePQ(
        ChangeKind kind,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        bytes calldata pq
    ) external nonReentrant returns (uint256 id) {
        return _proposeChange(kind, data, nonce, deadline, sig, pq);
    }

    function _proposeChange(
        ChangeKind kind,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig,
        bytes calldata pq
    ) internal returns (uint256 id) {
        _checkDeadline(deadline);
        if (data.length != _fieldWords(kind) * 32) revert BadData();
        bytes32 d = keccak256(
            bytes.concat(
                abi.encode(TAG, block.chainid, address(this), A_CHANGE, uint256(uint8(kind)), uint256(keyEpoch)),
                data,
                abi.encode(nonce, deadline)
            )
        );
        _useDigest(d);
        address s = _signer(d, sig);
        if (kind == ChangeKind.RECOVER_PUCK) {
            if (roleOf[s] != Role.GUARDIAN) revert NotGuardian();
            if (guardianList.length < 2) revert LastGuardian();
        } else if (s != puck) {
            revert NotPuck();
        } else {
            _pqCheck(d, pq);
        }
        _precheck(kind, data);

        id = ++changeCount;
        Change storage c = changes[id];
        c.kind = kind;
        c.data = data;
        c.proposedAt = uint64(block.timestamp);
        c.proposer = s;
        c.keyEpoch = keyEpoch;
        c.status = Status.PENDING;
        uint256 delay = _changeDelay(kind);
        c.readyAt = uint64(block.timestamp + delay);
        uint256 longest = kind == ChangeKind.REMOVE_GUARDIAN ? 2 * uint256(RECOVERY_DELAY) : delay;
        c.expiresAt = uint64(block.timestamp + longest + APPROVAL_WINDOW);
        emit ChangeProposed(id, kind, data, c.readyAt, s);

        if (kind == ChangeKind.REMOVE_PAYEE || kind == ChangeKind.REMOVE_WATCHER) {
            _applyChange(id, c);
        }
    }

    function approveChange(uint256 id, bytes calldata sig) external {
        Change storage c = changes[id];
        _changeLive(c);
        address s = _signer(_digest(A_CHANGE_APPROVE, abi.encode(id, uint256(uint8(c.kind)), keccak256(c.data))), sig);
        if (roleOf[s] != Role.GUARDIAN) revert NotGuardian();
        if (!_needsApproval(c.kind) && c.kind != ChangeKind.REMOVE_GUARDIAN) revert NotAllowed();
        if (c.approver != address(0)) revert AlreadyConfirmed();
        if (s == c.proposer) revert SameApprover();
        if (c.kind == ChangeKind.REMOVE_GUARDIAN && s == abi.decode(c.data, (address))) revert SameApprover();
        c.approver = s;
        emit ChangeApproved(id, s);
    }

    function vetoChange(uint256 id, bytes calldata sig) external {
        Change storage c = changes[id];
        _changeLive(c);
        address s = _signer(_digest(A_CHANGE_VETO, abi.encode(id)), sig);
        Role r = roleOf[s];
        if (c.kind == ChangeKind.REMOVE_GUARDIAN) {
            if (r == Role.PUCK) {
                c.status = Status.VETOED;
            } else if (r == Role.GUARDIAN && s != abi.decode(c.data, (address)) && c.approver != address(0)) {
                c.approver = address(0);
            } else {
                revert NotAllowed();
            }
        } else {
            if (r != Role.PUCK && r != Role.GUARDIAN && r != Role.WATCHER) revert NotAllowed();
            c.status = Status.VETOED;
        }
        emit ChangeVetoed(id, s);
    }

    function executeChange(uint256 id) external nonReentrant {
        Change storage c = changes[id];
        _changeLive(c);
        if (c.kind == ChangeKind.REMOVE_GUARDIAN && c.approver == address(0)) {
            if (block.timestamp < uint256(c.proposedAt) + 2 * uint256(RECOVERY_DELAY)) revert NotReady();
        } else {
            if (_needsApproval(c.kind) && c.approver == address(0)) revert NotConfirmed();
            if (block.timestamp < c.readyAt) revert NotReady();
        }
        _applyChange(id, c);
    }

    function tierFor(address to, address token, uint256 amount) public view returns (Tier) {
        Limits memory l = limits[token];
        uint256 today = _today();
        uint64 since = payeeSince[to];
        bool saved = since != 0 && block.timestamp >= uint256(since) + PROBATION;
        if (saved && amount <= l.instantMax && _window(instantSpent[token], today) + amount <= l.dailyCap) {
            return Tier.INSTANT;
        }
        if (!saved && amount * 2 > spendable(token)) return Tier.APPROVAL;
        if (_window(waitQueued[token], today) + amount <= l.waitMax) return Tier.WAIT;
        return Tier.APPROVAL;
    }

    function spendable(address token) public view returns (uint256) {
        if (token == address(0)) {
            uint256 b = address(this).balance;
            return b > GAS_RESERVE ? b - GAS_RESERVE : 0;
        }
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        return ok && ret.length >= 32 ? abi.decode(ret, (uint256)) : 0;
    }

    function windows(address token) external view returns (uint256 instant2d, uint256 wait2d, uint256 agent2d) {
        uint256 today = _today();
        instant2d = _window(instantSpent[token], today);
        wait2d = _window(waitQueued[token], today);
        agent2d = _window(agentSpent[token], today);
    }

    function getPayment(uint256 id) external view returns (Payment memory) {
        return payments[id];
    }

    function getChange(uint256 id) external view returns (Change memory) {
        return changes[id];
    }

    function getPendingIds() external view returns (uint256[] memory) {
        return pendingIds;
    }

    function getGuardians() external view returns (address[] memory) {
        return guardianList;
    }

    function getWatchers() external view returns (address[] memory) {
        return watcherList;
    }

    function getPayees() external view returns (address[] memory) {
        return payeeList;
    }

    function isFrozen() external view returns (bool) {
        return _isFrozen();
    }

    function digestFor(uint8 action, bytes calldata fields) external view returns (bytes32) {
        return _digest(action, fields);
    }

    function _confirm(uint256 id, Payment storage p, address by) internal {
        p.confirmed = true;
        if (block.timestamp >= p.releaseAt) {
            emit Confirmed(id, by, address(0));
            _release(id, p);
            return;
        }
        address sched = _schedule(id, p.releaseAt);
        p.schedule = sched;
        emit Confirmed(id, by, sched);
    }

    function _release(uint256 id, Payment storage p) internal {
        _removePending(id);
        p.status = Status.EXECUTED;
        _pay(p.to, p.token, p.amount);
        emit Executed(id, p.to, p.token, p.amount, msg.sender);
    }

    function _close(uint256 id, Payment storage p, Status st) internal {
        p.status = st;
        _removePending(id);
        if (p.tier == Tier.WAIT) {
            uint256 day = uint256(p.proposedAt) / 1 days;
            uint256 q = waitQueued[p.token][day];
            waitQueued[p.token][day] = q > p.amount ? q - p.amount : 0;
        }
        if (p.schedule != address(0)) {
            address s = p.schedule;
            p.schedule = address(0);
            (bool ok, bytes memory ret) = SCHEDULE_SERVICE.call(
                abi.encodeCall(IHederaScheduleService.deleteSchedule, (s))
            );
            int64 rc = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : int64(-1);
            emit ScheduleDeleted(id, s, rc);
        }
    }

    function _sweep() internal {
        uint256 i = pendingIds.length;
        while (i > 0) {
            i--;
            uint256 id = pendingIds[i];
            Payment storage p = payments[id];
            if (block.timestamp > p.expiresAt || p.epoch != epoch) {
                _close(id, p, Status.EXPIRED);
                emit Expired(id);
            }
        }
    }

    function _schedule(uint256 id, uint64 releaseAt) internal returns (address) {
        if (address(this).balance < GAS_RESERVE) {
            emit ScheduleFailed(id);
            return address(0);
        }
        bytes memory data = abi.encodeCall(this.execute, (id));
        uint256 when = uint256(releaseAt) + SCHEDULE_SLACK;
        for (uint256 i = 0; i < SCHEDULE_TRIES; i++) {
            (bool ok, bytes memory ret) = SCHEDULE_SERVICE.call(
                abi.encodeCall(IHederaScheduleService.scheduleCall, (address(this), when + i, EXEC_GAS, uint64(0), data))
            );
            if (ok && ret.length >= 64) {
                (int64 rc, address s) = abi.decode(ret, (int64, address));
                if (rc == HEDERA_SUCCESS && s != address(0)) return s;
            }
        }
        emit ScheduleFailed(id);
        return address(0);
    }

    function _pay(address to, address token, uint256 amount) internal {
        if (token == address(0)) {
            if (address(this).balance < amount + GAS_RESERVE) revert BelowGasReserve();
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
            if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
    }

    function _applyChange(uint256 id, Change storage c) internal {
        c.status = Status.EXECUTED;
        ChangeKind k = c.kind;
        bytes memory data = c.data;
        if (k == ChangeKind.ADD_PAYEE) {
            _addPayee(abi.decode(data, (address)));
        } else if (k == ChangeKind.REMOVE_PAYEE) {
            _removePayee(abi.decode(data, (address)));
        } else if (k == ChangeKind.SET_LIMITS) {
            (address token, uint128 a, uint128 b, uint128 cap, uint128 ag) =
                abi.decode(data, (address, uint128, uint128, uint128, uint128));
            _checkToken(token);
            limits[token] = Limits(a, b, cap, ag);
        } else if (k == ChangeKind.SET_COOLOFF) {
            uint32 v = abi.decode(data, (uint32));
            if (v < MIN_COOLOFF) revert BelowMinCoolOff();
            coolOff = v;
        } else if (k == ChangeKind.SET_AGENT) {
            address a = abi.decode(data, (address));
            if (agent != address(0)) roleOf[agent] = Role.NONE;
            agent = address(0);
            if (a != address(0)) {
                _addKey(a, Role.AGENT);
                agent = a;
            }
            keyEpoch += 1;
        } else if (k == ChangeKind.ADD_GUARDIAN) {
            address a = abi.decode(data, (address));
            if (guardianList.length >= MAX_GUARDIANS) revert TooManyKeys();
            _addKey(a, Role.GUARDIAN);
            guardianList.push(a);
            keyEpoch += 1;
        } else if (k == ChangeKind.REMOVE_GUARDIAN) {
            address a = abi.decode(data, (address));
            if (roleOf[a] != Role.GUARDIAN) revert UnknownKey();
            if (guardianList.length == 1) revert LastGuardian();
            _removeFrom(guardianList, a);
            roleOf[a] = Role.NONE;
            keyEpoch += 1;
        } else if (k == ChangeKind.ADD_WATCHER) {
            address a = abi.decode(data, (address));
            if (watcherList.length >= MAX_WATCHERS) revert TooManyKeys();
            _addKey(a, Role.WATCHER);
            watcherList.push(a);
            keyEpoch += 1;
        } else if (k == ChangeKind.REMOVE_WATCHER) {
            address a = abi.decode(data, (address));
            if (roleOf[a] != Role.WATCHER) revert UnknownKey();
            _removeFrom(watcherList, a);
            roleOf[a] = Role.NONE;
            keyEpoch += 1;
        } else if (k == ChangeKind.UNFREEZE) {
            frozenUntil = 0;
            emit Unfrozen();
        } else if (k == ChangeKind.RECOVER_PUCK) {
            address a = abi.decode(data, (address));
            roleOf[puck] = Role.NONE;
            _addKey(a, Role.PUCK);
            puck = a;
            keyEpoch += 1;
            // The lost puck's hash-based keys go with it. The new puck installs its own with SET_PQ_ROOT.
            pqRoot = bytes32(0);
            pqUsed = 0;
            emit PqRootSet(bytes32(0), PQ_HEIGHT);
        } else if (k == ChangeKind.SET_PQ_ROOT) {
            bytes32 root = abi.decode(data, (bytes32));
            pqRoot = root;
            pqUsed = 0;
            emit PqRootSet(root, PQ_HEIGHT);
        }
        emit ChangeExecuted(id, k);
    }

    function _precheck(ChangeKind kind, bytes calldata data) internal view {
        if (kind == ChangeKind.UNFREEZE) return;
        if (kind == ChangeKind.SET_PQ_ROOT) {
            if (abi.decode(data, (bytes32)) == bytes32(0)) revert BadData();
            return;
        }
        if (kind == ChangeKind.SET_COOLOFF) {
            uint256 v = abi.decode(data, (uint256));
            if (v < MIN_COOLOFF || v > type(uint32).max) revert BelowMinCoolOff();
            return;
        }
        if (kind == ChangeKind.SET_LIMITS) {
            (address token,,,,) = abi.decode(data, (address, uint256, uint256, uint256, uint256));
            _checkToken(token);
            return;
        }
        address a = abi.decode(data, (address));
        if (kind == ChangeKind.ADD_PAYEE) {
            if (a == address(0) || roleOf[a] != Role.NONE) revert KeyAlreadyUsed();
        } else if (kind == ChangeKind.REMOVE_PAYEE) {
            if (payeeSince[a] == 0) revert NotPayee();
        } else if (kind == ChangeKind.REMOVE_GUARDIAN) {
            if (roleOf[a] != Role.GUARDIAN) revert UnknownKey();
            if (guardianList.length == 1) revert LastGuardian();
        } else if (kind == ChangeKind.REMOVE_WATCHER) {
            if (roleOf[a] != Role.WATCHER) revert UnknownKey();
        } else if (kind == ChangeKind.SET_AGENT) {
            if (a != address(0) && (roleOf[a] != Role.NONE || payeeSince[a] != 0)) revert KeyAlreadyUsed();
        } else {
            if (a == address(0) || roleOf[a] != Role.NONE || payeeSince[a] != 0) revert KeyAlreadyUsed();
        }
    }

    function _fieldWords(ChangeKind kind) internal pure returns (uint256) {
        if (kind == ChangeKind.UNFREEZE) return 0;
        if (kind == ChangeKind.SET_LIMITS) return 5;
        return 1;
    }

    function _needsApproval(ChangeKind kind) internal pure returns (bool) {
        return kind != ChangeKind.REMOVE_PAYEE && kind != ChangeKind.REMOVE_WATCHER && kind != ChangeKind.REMOVE_GUARDIAN;
    }

    function _changeDelay(ChangeKind kind) internal view returns (uint256) {
        if (kind == ChangeKind.REMOVE_PAYEE || kind == ChangeKind.REMOVE_WATCHER) return 0;
        if (kind == ChangeKind.RECOVER_PUCK) return RECOVERY_DELAY;
        return SETTINGS_DELAY;
    }

    function _changeLive(Change storage c) internal view {
        if (c.status != Status.PENDING) revert NotPending();
        if (c.keyEpoch != keyEpoch) revert ChangeDead();
        if (block.timestamp > c.expiresAt) revert Expired_();
    }

    function _addKey(address a, Role r) internal {
        if (a == address(0) || roleOf[a] != Role.NONE || payeeSince[a] != 0) revert KeyAlreadyUsed();
        roleOf[a] = r;
    }

    function _addPayee(address a) internal {
        if (a == address(0) || roleOf[a] != Role.NONE) revert KeyAlreadyUsed();
        if (payeeSince[a] != 0) return;
        payeeSince[a] = uint64(block.timestamp);
        payeeList.push(a);
    }

    function _removePayee(address a) internal {
        if (payeeSince[a] == 0) return;
        payeeSince[a] = 0;
        _removeFrom(payeeList, a);
    }

    function _removeFrom(address[] storage list, address a) internal {
        uint256 n = list.length;
        for (uint256 i = 0; i < n; i++) {
            if (list[i] == a) {
                list[i] = list[n - 1];
                list.pop();
                return;
            }
        }
    }

    function _removePending(uint256 id) internal {
        uint256 n = pendingIds.length;
        for (uint256 i = 0; i < n; i++) {
            if (pendingIds[i] == id) {
                pendingIds[i] = pendingIds[n - 1];
                pendingIds.pop();
                return;
            }
        }
    }

    function _live(uint256 id) internal view returns (Payment storage p) {
        p = payments[id];
        if (p.status != Status.PENDING) revert NotPending();
        if (p.epoch != epoch) revert OldEpoch();
        if (block.timestamp > p.expiresAt) revert Expired_();
    }

    function _digest(uint8 action, bytes memory fields) internal view returns (bytes32) {
        return keccak256(bytes.concat(abi.encode(TAG, block.chainid, address(this), action), fields));
    }

    function _signer(bytes32 digest, bytes calldata sig) internal view returns (address) {
        if (sig.length == 0) return msg.sender;
        (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest), sig);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
        return s;
    }

    /// Requires a valid, unused hash-based signature over `d` when the vault has a PQ root.
    function _pqCheck(bytes32 d, bytes calldata pq) internal {
        bytes32 root = pqRoot;
        if (root == bytes32(0)) return;
        if (pq.length == 0) revert PqRequired();
        (bytes32 got, uint32 leaf, uint256 height) = PQ_VERIFIER.check(block.chainid, address(this), d, pq);
        if (got != root || height != PQ_HEIGHT) revert PqBadSignature();
        if (pqLeafUsed[root][leaf]) revert PqLeafUsed();
        pqLeafUsed[root][leaf] = true;
        pqUsed += 1;
        emit PqSigned(leaf, pqUsed);
    }

    function _useDigest(bytes32 d) internal {
        if (usedDigest[d]) revert Replayed();
        usedDigest[d] = true;
    }

    function _checkDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert Expired_();
        if (deadline > block.timestamp + MAX_DEADLINE) revert DeadlineTooFar();
    }

    function _checkToken(address token) internal view {
        if (token != address(0) && token != USDC) revert BadToken();
    }

    function _notFrozen() internal view {
        if (_isFrozen()) revert IsFrozen();
    }

    function _isFrozen() internal view returns (bool) {
        return block.timestamp < frozenUntil;
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _window(mapping(uint256 => uint256) storage m, uint256 today) internal view returns (uint256) {
        return m[today] + (today > 0 ? m[today - 1] : 0);
    }
}
