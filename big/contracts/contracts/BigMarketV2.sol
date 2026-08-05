// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract BigMarketV2 is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    uint256 public constant PLATFORM_FEE_BPS = 200; // 2% = 200 basis points
    uint256 public constant MAX_IMAGE_SIZE = 5120; // 5KB = 5120 bytes
    
    struct Event {
        string title;
        string category;
        bytes imageData;
        string context;
        uint256 endTime;
        string[] outcomes;
        uint256[] pools; // Total amount bet on each outcome
        uint256 totalPool; // Total amount in all pools
        bool resolved;
        uint256 winningOutcome; // Index of winning outcome (0-indexed)
        address creator;
    }
    
    mapping(uint256 => Event) public events;
    mapping(address => bool) public authorizedCreators;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public bets; // eventId => user => outcome => amount
    mapping(uint256 => mapping(address => bool)) public claimed; // eventId => user => claimed
    
    uint256 public eventCount;
    uint256 public totalPlatformFees;
    
    // Original events (maintained for backward compatibility)
    event EventCreated(uint256 indexed eventId, address indexed creator, string title, string category);
    event EventUpdated(uint256 indexed eventId, address indexed updater);
    event BetPlaced(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount);
    event EventResolved(uint256 indexed eventId, uint256 winningOutcome);
    event PayoutClaimed(uint256 indexed eventId, address indexed user, uint256 amount);
    event CreatorAuthorized(address indexed creator);
    event CreatorRevoked(address indexed creator);
    
    // Enhanced event with additional data for better portfolio and activity tracking
    event BetPlacedEnhanced(
        uint256 indexed eventId,
        address indexed user,
        uint256 outcome,
        uint256 amount,
        uint256 timestamp,
        uint256 totalPool,
        uint256 outcomePool
    );
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }
    
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
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
        require(
            msg.sender == owner() || authorizedCreators[msg.sender],
            "Not authorized to create events"
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
            "Not authorized to update this event"
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
        
        // Emit original event for backward compatibility
        emit BetPlaced(eventId, msg.sender, outcome, betAmount);
        
        // Emit enhanced event with additional data for better tracking
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
            if (i == eventData.winningOutcome) {
                winningBet = userBet;
            }
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
    
    receive() external payable {
        revert("Direct payments not allowed");
    }
}
