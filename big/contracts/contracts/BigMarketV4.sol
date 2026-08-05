// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract BigMarketV4 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
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

    mapping(uint256 => Event) public events;
    mapping(address => bool) public authorizedCreators;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public bets;
    mapping(uint256 => mapping(address => bool)) public claimed;

    uint256 public eventCount;
    uint256 public totalPlatformFees;

    // V3
    bool public paused;

    // V4 (append-only storage changes)
    mapping(address => bool) public admins;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public referralVolume;
    mapping(address => uint256) public referralPoints;
    mapping(address => uint256) public userVolume;
    mapping(address => uint256) public userPoints;
    mapping(address => uint256) public referredUsersCount;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner() || admins[msg.sender], "Not authorized");
        _;
    }

    modifier onlyWhitelistManager() {
        require(msg.sender == owner() || admins[msg.sender] || authorizedCreators[msg.sender], "Not authorized");
        _;
    }

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

    function authorizeCreator(address creator) external onlyWhitelistManager {
        authorizedCreators[creator] = true;
        emit CreatorAuthorized(creator);
    }

    function revokeCreator(address creator) external onlyWhitelistManager {
        authorizedCreators[creator] = false;
        emit CreatorRevoked(creator);
    }

    function createEvent(
        string memory title,
        string memory category,
        bytes memory imageData,
        string memory context,
        uint256 endTime,
        string[] memory outcomes
    ) external {
        require(!paused, "Contract paused");
        require(msg.sender == owner() || admins[msg.sender] || authorizedCreators[msg.sender], "Not authorized");
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
        require(msg.sender == owner() || admins[msg.sender] || msg.sender == eventData.creator, "Not authorized");
        require(!eventData.resolved, "Cannot update resolved event");
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

    function placeBet(uint256 eventId, uint256 outcome) external payable nonReentrant {
        _placeBet(eventId, outcome, address(0));
    }

    function placeBetWithReferrer(uint256 eventId, uint256 outcome, address referrer) external payable nonReentrant {
        _placeBet(eventId, outcome, referrer);
    }

    function _placeBet(uint256 eventId, uint256 outcome, address referrer) internal {
        require(!paused, "Contract paused");
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(block.timestamp < eventData.endTime, "Event has ended");
        require(outcome < eventData.outcomes.length, "Invalid outcome");
        require(msg.value > 0, "Must bet something");

        uint256 platformFee = (msg.value * PLATFORM_FEE_BPS) / 10000;
        uint256 betAmount = msg.value - platformFee;
        totalPlatformFees += platformFee;
        eventData.pools[outcome] += betAmount;
        eventData.totalPool += betAmount;
        bets[eventId][msg.sender][outcome] += betAmount;

        // User points and volume
        userVolume[msg.sender] += betAmount;
        uint256 userPts = (betAmount * USER_POINTS_PER_POL) / 1e18;
        if (userPts > 0) {
            userPoints[msg.sender] += userPts;
            emit UserPointsAccrued(msg.sender, betAmount, userPts);
        }

        // Register one-time referrer if provided and valid
        if (referrer != address(0) && referrer != msg.sender && referrerOf[msg.sender] == address(0)) {
            referrerOf[msg.sender] = referrer;
            referredUsersCount[referrer] += 1;
            emit ReferralRegistered(msg.sender, referrer);
        }

        // Track referral volume/points
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

    function resolveEvent(uint256 eventId, uint256 winningOutcome) external onlyOwnerOrAdmin {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(!eventData.resolved, "Event already resolved");
        require(block.timestamp >= eventData.endTime, "Event has not ended");
        require(winningOutcome < eventData.outcomes.length, "Invalid outcome");
        eventData.resolved = true;
        eventData.winningOutcome = winningOutcome;
        emit EventResolved(eventId, winningOutcome);
    }

    function claimPayout(uint256 eventId) external nonReentrant {
        Event storage eventData = events[eventId];
        require(eventData.creator != address(0), "Event does not exist");
        require(eventData.resolved, "Event not resolved");
        require(!claimed[eventId][msg.sender], "Already claimed");

        uint256 totalUserBet = 0;
        uint256 winningBet = 0;
        for (uint256 i = 0; i < eventData.outcomes.length; i++) {
            uint256 userBet = bets[eventId][msg.sender][i];
            totalUserBet += userBet;
            if (i == eventData.winningOutcome) winningBet = userBet;
        }
        require(totalUserBet > 0, "No bets to claim");

        uint256 payout = 0;
        if (eventData.totalPool > 0 && winningBet > 0) {
            uint256 winningPool = eventData.pools[eventData.winningOutcome];
            require(winningPool > 0, "No bets on winning outcome");
            payout = (eventData.totalPool * winningBet) / winningPool;
        }
        claimed[eventId][msg.sender] = true;
        if (payout > 0) {
            (bool success, ) = payable(msg.sender).call{value: payout}("");
            require(success, "Transfer failed");
            emit PayoutClaimed(eventId, msg.sender, payout);
        }
    }

    function getUserBet(uint256 eventId, address user, uint256 outcome) external view returns (uint256) {
        return bets[eventId][user][outcome];
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        return events[eventId];
    }

    function getReferralStats(address referrer) external view returns (uint256 volume, uint256 points, uint256 usersReferred) {
        return (referralVolume[referrer], referralPoints[referrer], referredUsersCount[referrer]);
    }

    function getUserStats(address user) external view returns (uint256 volume, uint256 points, address referrer) {
        return (userVolume[user], userPoints[user], referrerOf[user]);
    }

    function withdrawPlatformFees() external onlyOwnerOrAdmin {
        uint256 amount = totalPlatformFees;
        totalPlatformFees = 0;
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice Emergency: when paused, admin can withdraw full contract balance to owner wallet.
    function emergencyWithdrawAll() external onlyOwnerOrAdmin nonReentrant {
        require(paused, "Must pause first");
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to withdraw");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
        emit EmergencyWithdraw(owner(), amount);
    }

    receive() external payable {
        revert("Direct payments not allowed");
    }
}
