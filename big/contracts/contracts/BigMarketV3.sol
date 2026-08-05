// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract BigMarketV3 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    uint256 public constant PLATFORM_FEE_BPS = 200;
    uint256 public constant MAX_IMAGE_SIZE = 5120;

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

    // V3: emergency pause and withdraw (append to storage layout)
    bool public paused;

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

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function authorizeCreator(address creator) external onlyOwner {
        authorizedCreators[creator] = true;
        emit CreatorAuthorized(creator);
    }

    function revokeCreator(address creator) external onlyOwner {
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
        require(
            msg.sender == owner() || authorizedCreators[msg.sender],
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
            msg.sender == owner() || msg.sender == eventData.creator,
            "Not authorized"
        );
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

    function resolveEvent(uint256 eventId, uint256 winningOutcome) external onlyOwner {
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

    function withdrawPlatformFees() external onlyOwner {
        uint256 amount = totalPlatformFees;
        totalPlatformFees = 0;
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice Emergency: when paused, owner can withdraw full contract balance. Use only in emergency.
    function emergencyWithdrawAll() external onlyOwner nonReentrant {
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
