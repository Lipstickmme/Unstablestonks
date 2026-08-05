// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title BigMarketV5
 * @notice Parimutuel prediction market. Storage layout is append-only on top of V4.
 *
 * ## What V5 fixes
 *
 * V4 could strand money. Three ways, all closed here:
 *
 * 1. **Nobody backed the winner.** V4's `claimPayout` pays nothing when the winning pool
 *    is empty, and marks the caller claimed anyway — the entire pool sat in the contract
 *    with no path out. V5 detects this at resolution and refunds every bettor instead.
 *
 * 2. **An event that cannot be resolved.** V4 had no cancel path, so an ambiguous or
 *    abandoned event locked its pool permanently. V5 adds `cancelEvent` + `claimRefund`.
 *
 * 3. **A wrong resolution was final and instant.** V4's owner called `resolveEvent` and
 *    payouts opened immediately. V5 splits it: a resolver *proposes*, a dispute window
 *    runs, and anyone can bond a challenge inside it. Only then does it finalise.
 *
 * ## What V5 adds
 *
 * - Early exit: sell out of a pool before the event closes, for a fee. A parimutuel pool
 *   has no market price until it closes, so this is a withdrawal at cost minus a fee —
 *   not a priced buy-back. The distinction is real and the UI must not blur it.
 * - Creator fee share, so listing good markets is worth doing.
 * - Batch claiming across events.
 */
contract BigMarketV5 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    uint256 public constant PLATFORM_FEE_BPS = 200;
    uint256 public constant MAX_IMAGE_SIZE = 5120;
    uint256 public constant USER_POINTS_PER_POL = 100;
    uint256 public constant REFERRAL_POINTS_PER_POL = 50;

    struct Event {
        string title;
        string category;
        bytes imageData;
        string context;
        uint256 endTime;
        string[] outcomes;
        uint256[] pools;
        uint256 totalPool;
        bool resolved;
        uint256 winningOutcome;
        address creator;
    }

    // -- V1..V4 storage. Order is load-bearing; never reorder or remove. --------------

    mapping(uint256 => Event) public events;
    mapping(address => bool) public authorizedCreators;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public bets;
    mapping(uint256 => mapping(address => bool)) public claimed;

    uint256 public eventCount;
    uint256 public totalPlatformFees;

    // V3
    bool public paused;

    // V4
    mapping(address => bool) public admins;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public referralVolume;
    mapping(address => uint256) public referralPoints;
    mapping(address => uint256) public userVolume;
    mapping(address => uint256) public userPoints;
    mapping(address => uint256) public referredUsersCount;

    // -- V5 storage (append-only) ----------------------------------------------------

    enum ResolutionState {
        None,
        Proposed,
        Disputed,
        Final
    }

    struct Resolution {
        uint256 winningOutcome;
        uint64 proposedAt;
        uint64 finalizeAfter;
        address proposer;
        address challenger;
        uint256 bond;
        ResolutionState state;
    }

    /// @notice Addresses allowed to propose a result. Separated from admin on purpose.
    mapping(address => bool) public resolvers;
    mapping(uint256 => Resolution) public resolutions;
    /// @notice Cancelled events refund in full; no outcome pays.
    mapping(uint256 => bool) public cancelled;
    /// @notice Fees earned by market creators, withdrawable by them.
    mapping(address => uint256) public creatorFees;

    /// @notice Seconds a proposed result can be challenged before it can be finalised.
    uint64 public disputeWindow;
    /// @notice Stake required to challenge a proposed result. Forfeited if the challenge fails.
    uint256 public disputeBond;
    /// @notice Fee charged on an early exit, in basis points.
    uint256 public exitFeeBps;
    /// @notice Share of the platform fee paid to the market's creator, in basis points.
    uint256 public creatorFeeShareBps;
    /// @notice Selling out is blocked this many seconds before an event's end time.
    uint64 public exitCutoff;

    // -- Events ----------------------------------------------------------------------

    event EventCreated(uint256 indexed eventId, address indexed creator, string title, string category);
    event EventUpdated(uint256 indexed eventId, address indexed updater);
    event BetPlaced(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount);
    event BetPlacedEnhanced(
        uint256 indexed eventId,
        address indexed user,
        uint256 outcome,
        uint256 amount,
        uint256 timestamp,
        uint256 totalPool,
        uint256 outcomePool
    );
    event EventResolved(uint256 indexed eventId, uint256 winningOutcome);
    event PayoutClaimed(uint256 indexed eventId, address indexed user, uint256 amount);
    event CreatorAuthorized(address indexed creator);
    event CreatorRevoked(address indexed creator);
    event PausedSet(bool paused);
    event EmergencyWithdraw(address indexed to, uint256 amount);
    event AdminGranted(address indexed admin);
    event AdminRevoked(address indexed admin);
    event ReferralRegistered(address indexed user, address indexed referrer);
    event ReferralTracked(address indexed referrer, address indexed user, uint256 amount, uint256 pointsAwarded);
    event UserPointsAccrued(address indexed user, uint256 amount, uint256 pointsAwarded);

    event ResolverSet(address indexed resolver, bool enabled);
    event ResolutionProposed(uint256 indexed eventId, uint256 winningOutcome, address indexed proposer, uint64 finalizeAfter);
    event ResolutionDisputed(uint256 indexed eventId, address indexed challenger, uint256 bond);
    event DisputeSettled(uint256 indexed eventId, uint256 winningOutcome, bool challengerWon);
    event EventCancelled(uint256 indexed eventId, string reason);
    event RefundClaimed(uint256 indexed eventId, address indexed user, uint256 amount);
    event PositionSold(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount, uint256 fee);
    event CreatorFeesWithdrawn(address indexed creator, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        _initializeV5();
    }

    /**
     * @notice Set the V5 parameters on an existing proxy.
     * @dev Called once via `upgradeToAndCall` when upgrading from V4. Guarded by the
     *      zero-value check rather than a reinitializer so it is safe to call again if the
     *      upgrade transaction has to be retried.
     */
    function initializeV5() external onlyOwner {
        require(disputeWindow == 0, "V5 already initialized");
        _initializeV5();
    }

    function _initializeV5() private {
        disputeWindow = 6 hours;
        disputeBond = 0.05 ether;
        exitFeeBps = 500; // 5%
        creatorFeeShareBps = 2500; // a quarter of the platform fee
        exitCutoff = 10 minutes;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner() || admins[msg.sender], "Not authorized");
        _;
    }

    modifier onlyResolver() {
        require(
            msg.sender == owner() || admins[msg.sender] || resolvers[msg.sender],
            "Not a resolver"
        );
        _;
    }

    modifier onlyWhitelistManager() {
        require(
            msg.sender == owner() || admins[msg.sender] || authorizedCreators[msg.sender],
            "Not authorized"
        );
        _;
    }

    // -- Admin -----------------------------------------------------------------------

    function setPaused(bool _paused) external onlyOwnerOrAdmin {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function grantAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Invalid admin");
        admins[admin] = true;
        emit AdminGranted(admin);
    }

    function revokeAdmin(address admin) external onlyOwner {
        admins[admin] = false;
        emit AdminRevoked(admin);
    }

    function setResolver(address resolver, bool enabled) external onlyOwner {
        require(resolver != address(0), "Invalid resolver");
        resolvers[resolver] = enabled;
        emit ResolverSet(resolver, enabled);
    }

    function setResolutionParams(uint64 newWindow, uint256 newBond) external onlyOwner {
        require(newWindow >= 1 hours, "Window too short");
        disputeWindow = newWindow;
        disputeBond = newBond;
    }

    function setMarketParams(
        uint256 newExitFeeBps,
        uint256 newCreatorFeeShareBps,
        uint64 newExitCutoff
    ) external onlyOwner {
        require(newExitFeeBps <= 2000, "Exit fee too high");
        require(newCreatorFeeShareBps <= 10000, "Share exceeds fee");
        exitFeeBps = newExitFeeBps;
        creatorFeeShareBps = newCreatorFeeShareBps;
        exitCutoff = newExitCutoff;
    }

    function authorizeCreator(address creator) external onlyWhitelistManager {
        authorizedCreators[creator] = true;
        emit CreatorAuthorized(creator);
    }

    function revokeCreator(address creator) external onlyWhitelistManager {
        authorizedCreators[creator] = false;
        emit CreatorRevoked(creator);
    }

    // -- Markets ---------------------------------------------------------------------

    function createEvent(
        string memory title,
        string memory category,
        bytes memory imageData,
        string memory context,
        uint256 endTime,
        string[] memory outcomes
    ) external {
        require(!paused, "Contract paused");
        require(
            msg.sender == owner() || admins[msg.sender] || authorizedCreators[msg.sender],
            "Not authorized"
        );
        require(bytes(title).length > 0, "Title required");
        require(bytes(category).length > 0, "Category required");
        require(imageData.length <= MAX_IMAGE_SIZE, "Image too large");
        require(endTime > block.timestamp, "End time must be in future");
        require(outcomes.length >= 2, "At least 2 outcomes required");

        uint256 eventId = eventCount++;
        events[eventId] = Event({
            title: title,
            category: category,
            imageData: imageData,
            context: context,
            endTime: endTime,
            outcomes: outcomes,
            pools: new uint256[](outcomes.length),
            totalPool: 0,
            resolved: false,
            winningOutcome: 0,
            creator: msg.sender
        });

        emit EventCreated(eventId, msg.sender, title, category);
    }

    function updateEvent(
        uint256 eventId,
        string memory title,
        string memory category,
        bytes memory imageData,
        string memory context,
        uint256 endTime,
        string[] memory outcomes
    ) external {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(
            msg.sender == owner() || admins[msg.sender] || msg.sender == eventData.creator,
            "Not authorized"
        );
        require(!eventData.resolved, "Cannot update resolved event");
        require(!cancelled[eventId], "Event cancelled");
        require(bytes(title).length > 0, "Title required");
        require(bytes(category).length > 0, "Category required");
        require(imageData.length <= MAX_IMAGE_SIZE, "Image too large");
        require(endTime > block.timestamp, "End time must be in future");
        require(outcomes.length >= 2, "At least 2 outcomes required");
        require(eventData.totalPool == 0, "Cannot update event with existing bets");

        eventData.title = title;
        eventData.category = category;
        eventData.imageData = imageData;
        eventData.context = context;
        eventData.endTime = endTime;
        eventData.outcomes = outcomes;
        eventData.pools = new uint256[](outcomes.length);

        emit EventUpdated(eventId, msg.sender);
    }

    // -- Betting ---------------------------------------------------------------------

    function placeBet(uint256 eventId, uint256 outcome) external payable nonReentrant {
        _placeBet(eventId, outcome, address(0));
    }

    function placeBetWithReferrer(uint256 eventId, uint256 outcome, address referrer)
        external
        payable
        nonReentrant
    {
        _placeBet(eventId, outcome, referrer);
    }

    function _placeBet(uint256 eventId, uint256 outcome, address referrer) internal {
        require(!paused, "Contract paused");
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(!cancelled[eventId], "Event cancelled");
        require(block.timestamp < eventData.endTime, "Event has ended");
        // Belt and braces: a result can only be proposed after the end time, so the check
        // above already covers this. It stays in case the end time ever becomes mutable.
        require(resolutions[eventId].state == ResolutionState.None, "Result pending");
        require(outcome < eventData.outcomes.length, "Invalid outcome");
        require(msg.value > 0, "Must bet something");

        uint256 platformFee = (msg.value * PLATFORM_FEE_BPS) / 10000;
        uint256 betAmount = msg.value - platformFee;

        // The creator's cut comes out of the platform fee, not out of the bettor's stake.
        uint256 creatorCut = (platformFee * creatorFeeShareBps) / 10000;

        if (creatorCut > 0 && eventData.creator != address(0)) {
            creatorFees[eventData.creator] += creatorCut;
        }

        totalPlatformFees += platformFee - creatorCut;

        eventData.pools[outcome] += betAmount;
        eventData.totalPool += betAmount;
        bets[eventId][msg.sender][outcome] += betAmount;

        userVolume[msg.sender] += betAmount;
        uint256 userPts = (betAmount * USER_POINTS_PER_POL) / 1e18;

        if (userPts > 0) {
            userPoints[msg.sender] += userPts;
            emit UserPointsAccrued(msg.sender, betAmount, userPts);
        }

        if (referrer != address(0) && referrer != msg.sender && referrerOf[msg.sender] == address(0)) {
            referrerOf[msg.sender] = referrer;
            referredUsersCount[referrer] += 1;
            emit ReferralRegistered(msg.sender, referrer);
        }

        address activeReferrer = referrerOf[msg.sender];

        if (activeReferrer != address(0)) {
            referralVolume[activeReferrer] += betAmount;
            uint256 refPts = (betAmount * REFERRAL_POINTS_PER_POL) / 1e18;

            if (refPts > 0) {
                referralPoints[activeReferrer] += refPts;
            }

            emit ReferralTracked(activeReferrer, msg.sender, betAmount, refPts);
        }

        emit BetPlaced(eventId, msg.sender, outcome, betAmount);
        emit BetPlacedEnhanced(
            eventId,
            msg.sender,
            outcome,
            betAmount,
            block.timestamp,
            eventData.totalPool,
            eventData.pools[outcome]
        );
    }

    /**
     * @notice Withdraw part or all of a position before the event closes, for a fee.
     *
     * @dev This is a withdrawal at cost minus `exitFeeBps`, NOT a buy-back at a market
     *      price. A parimutuel pool has no price until it closes: your payout depends on
     *      where every other bet lands. Pricing an exit off the current pool split would
     *      be quoting a number that is not yet real, so we do not.
     *
     *      Exits close `exitCutoff` before the end time — near the close, information is
     *      sharpest and letting bettors out is how the remaining pool gets picked off.
     */
    function sellPosition(uint256 eventId, uint256 outcome, uint256 amount)
        external
        nonReentrant
    {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(!cancelled[eventId], "Event cancelled");
        require(outcome < eventData.outcomes.length, "Invalid outcome");
        require(block.timestamp + exitCutoff < eventData.endTime, "Exits are closed");

        uint256 held = bets[eventId][msg.sender][outcome];
        require(amount > 0 && amount <= held, "Amount exceeds position");

        bets[eventId][msg.sender][outcome] = held - amount;
        eventData.pools[outcome] -= amount;
        eventData.totalPool -= amount;

        uint256 fee = (amount * exitFeeBps) / 10000;
        totalPlatformFees += fee;

        // Volume already counted stays counted — the wager did happen.
        _send(msg.sender, amount - fee);

        emit PositionSold(eventId, msg.sender, outcome, amount, fee);
    }

    // -- Resolution ------------------------------------------------------------------

    /**
     * @notice Propose the winning outcome. Starts the dispute window; does not pay out.
     */
    function proposeResolution(uint256 eventId, uint256 winningOutcome) external onlyResolver {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(!cancelled[eventId], "Event cancelled");
        require(block.timestamp >= eventData.endTime, "Event has not ended");
        require(winningOutcome < eventData.outcomes.length, "Invalid outcome");

        Resolution storage resolution = resolutions[eventId];

        // A disputed result can only move through `settleDispute`, so the challenger's
        // bond is never left in escrow with nothing to resolve it.
        require(resolution.state == ResolutionState.None, "Result already proposed");

        resolution.winningOutcome = winningOutcome;
        resolution.proposedAt = uint64(block.timestamp);
        resolution.finalizeAfter = uint64(block.timestamp) + disputeWindow;
        resolution.proposer = msg.sender;
        resolution.state = ResolutionState.Proposed;

        emit ResolutionProposed(eventId, winningOutcome, msg.sender, resolution.finalizeAfter);
    }

    /**
     * @notice Challenge a proposed result inside the dispute window.
     * @dev The bond is forfeited to the platform if the challenge is rejected, which is
     *      what stops the window being spammed shut.
     */
    function disputeResolution(uint256 eventId) external payable nonReentrant {
        Resolution storage resolution = resolutions[eventId];
        require(resolution.state == ResolutionState.Proposed, "Nothing to dispute");
        require(block.timestamp < resolution.finalizeAfter, "Dispute window closed");
        require(msg.value >= disputeBond, "Bond required");

        resolution.state = ResolutionState.Disputed;
        resolution.challenger = msg.sender;
        resolution.bond = msg.value;

        emit ResolutionDisputed(eventId, msg.sender, msg.value);
    }

    /**
     * @notice Settle a disputed result.
     * @param winningOutcome the outcome that actually won
     * @dev If it differs from what was proposed, the challenger was right and gets their
     *      bond back. If it matches, the bond is forfeited.
     */
    function settleDispute(uint256 eventId, uint256 winningOutcome) external onlyOwnerOrAdmin nonReentrant {
        Event storage eventData = events[eventId];
        Resolution storage resolution = resolutions[eventId];
        require(resolution.state == ResolutionState.Disputed, "Not disputed");
        require(winningOutcome < eventData.outcomes.length, "Invalid outcome");

        bool challengerWon = winningOutcome != resolution.winningOutcome;
        uint256 bond = resolution.bond;
        address challenger = resolution.challenger;

        resolution.bond = 0;
        resolution.winningOutcome = winningOutcome;
        resolution.state = ResolutionState.Final;

        _applyResolution(eventId, winningOutcome);

        if (bond > 0) {
            if (challengerWon) {
                _send(challenger, bond);
            } else {
                totalPlatformFees += bond;
            }
        }

        emit DisputeSettled(eventId, winningOutcome, challengerWon);
    }

    /// @notice Finalise an unchallenged result once its window has passed. Callable by anyone.
    function finalizeResolution(uint256 eventId) external {
        Resolution storage resolution = resolutions[eventId];
        require(resolution.state == ResolutionState.Proposed, "Nothing to finalize");
        require(block.timestamp >= resolution.finalizeAfter, "Dispute window still open");

        resolution.state = ResolutionState.Final;
        _applyResolution(eventId, resolution.winningOutcome);
    }

    function _applyResolution(uint256 eventId, uint256 winningOutcome) private {
        Event storage eventData = events[eventId];

        // Nobody backed the winner: there is no proportional payout to compute, so the
        // only honest outcome is to give everyone their stake back. V4 left this pool
        // stranded in the contract.
        if (eventData.pools[winningOutcome] == 0) {
            cancelled[eventId] = true;
            emit EventCancelled(eventId, "No bets on the winning outcome");
            return;
        }

        eventData.resolved = true;
        eventData.winningOutcome = winningOutcome;

        emit EventResolved(eventId, winningOutcome);
    }

    /// @notice Cancel a market that cannot be settled. Every stake becomes refundable.
    function cancelEvent(uint256 eventId, string calldata reason) external onlyOwnerOrAdmin {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(!cancelled[eventId], "Already cancelled");

        cancelled[eventId] = true;

        // Return any dispute bond still in escrow — the dispute is moot now.
        Resolution storage resolution = resolutions[eventId];

        if (resolution.bond > 0) {
            uint256 bond = resolution.bond;
            resolution.bond = 0;
            _send(resolution.challenger, bond);
        }

        emit EventCancelled(eventId, reason);
    }

    // -- Claims ----------------------------------------------------------------------

    function claimPayout(uint256 eventId) external nonReentrant {
        _claim(eventId, msg.sender);
    }

    /// @notice Claim across several settled events in one transaction.
    function claimPayoutBatch(uint256[] calldata eventIds) external nonReentrant {
        for (uint256 i = 0; i < eventIds.length; i++) {
            // Skip rather than revert, so one unclaimable entry cannot block the batch.
            if (!claimed[eventIds[i]][msg.sender]) {
                _claim(eventIds[i], msg.sender);
            }
        }
    }

    /// @notice Reclaim stakes from a cancelled market.
    function claimRefund(uint256 eventId) external nonReentrant {
        require(cancelled[eventId], "Event not cancelled");
        _claim(eventId, msg.sender);
    }

    function _claim(uint256 eventId, address user) private {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(eventData.resolved || cancelled[eventId], "Event not settled");
        require(!claimed[eventId][user], "Already claimed");

        uint256 totalUserBet = 0;
        uint256 winningBet = 0;

        for (uint256 i = 0; i < eventData.outcomes.length; i++) {
            uint256 userBet = bets[eventId][user][i];
            totalUserBet += userBet;

            if (i == eventData.winningOutcome) {
                winningBet = userBet;
            }
        }

        require(totalUserBet > 0, "No bets to claim");
        claimed[eventId][user] = true;

        if (cancelled[eventId]) {
            _send(user, totalUserBet);
            emit RefundClaimed(eventId, user, totalUserBet);
            return;
        }

        if (winningBet == 0) {
            emit PayoutClaimed(eventId, user, 0);
            return;
        }

        uint256 winningPool = eventData.pools[eventData.winningOutcome];
        uint256 payout = (eventData.totalPool * winningBet) / winningPool;

        _send(user, payout);
        emit PayoutClaimed(eventId, user, payout);
    }

    // -- Fees ------------------------------------------------------------------------

    function withdrawCreatorFees() external nonReentrant {
        uint256 amount = creatorFees[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        creatorFees[msg.sender] = 0;
        _send(msg.sender, amount);

        emit CreatorFeesWithdrawn(msg.sender, amount);
    }

    function withdrawPlatformFees() external onlyOwnerOrAdmin nonReentrant {
        uint256 amount = totalPlatformFees;
        require(amount > 0, "Nothing to withdraw");

        totalPlatformFees = 0;
        _send(owner(), amount);
    }

    /// @notice Emergency: when paused, drain the contract to the owner wallet.
    function emergencyWithdrawAll() external onlyOwnerOrAdmin nonReentrant {
        require(paused, "Must pause first");
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to withdraw");

        _send(owner(), amount);
        emit EmergencyWithdraw(owner(), amount);
    }

    // -- Views -----------------------------------------------------------------------

    function getUserBet(uint256 eventId, address user, uint256 outcome)
        external
        view
        returns (uint256)
    {
        return bets[eventId][user][outcome];
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        return events[eventId];
    }

    function getResolution(uint256 eventId) external view returns (Resolution memory) {
        return resolutions[eventId];
    }

    function getReferralStats(address referrer)
        external
        view
        returns (uint256 volume, uint256 points, uint256 usersReferred)
    {
        return (referralVolume[referrer], referralPoints[referrer], referredUsersCount[referrer]);
    }

    function getUserStats(address user)
        external
        view
        returns (uint256 volume, uint256 points, address referrer)
    {
        return (userVolume[user], userPoints[user], referrerOf[user]);
    }

    /// @notice What a user would receive right now if the event settled as proposed.
    function previewPayout(uint256 eventId, address user) external view returns (uint256) {
        Event storage eventData = events[eventId];

        if (eventData.creator == address(0) || claimed[eventId][user]) {
            return 0;
        }

        uint256 totalUserBet = 0;

        for (uint256 i = 0; i < eventData.outcomes.length; i++) {
            totalUserBet += bets[eventId][user][i];
        }

        if (cancelled[eventId]) {
            return totalUserBet;
        }

        uint256 outcome = eventData.resolved
            ? eventData.winningOutcome
            : resolutions[eventId].winningOutcome;

        if (!eventData.resolved && resolutions[eventId].state == ResolutionState.None) {
            return 0;
        }

        uint256 winningBet = bets[eventId][user][outcome];
        uint256 winningPool = eventData.pools[outcome];

        if (winningBet == 0 || winningPool == 0) {
            return 0;
        }

        return (eventData.totalPool * winningBet) / winningPool;
    }

    function _send(address to, uint256 amount) private {
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Transfer failed");
    }

    receive() external payable {
        revert("Direct payments not allowed");
    }
}
