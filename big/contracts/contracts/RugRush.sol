// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title RugRush
 * @notice A crash game where every round is a simulated token launch.
 *
 * The curve is the token's price going parabolic; the crash is the rug. Players buy in
 * before the launch and sell any time before the rug — sell late and the position is
 * worth nothing, exactly like the real thing.
 *
 * ## Fairness
 *
 * The operator commits `keccak256(serverSeed)` before betting opens and reveals
 * `serverSeed` after the round ends. The rug multiplier is derived from the committed
 * seed and a public client seed, so it is fixed before the first bet and verifiable
 * afterwards by anyone.
 *
 * ## Trust model — stated plainly
 *
 * - The operator cannot change the rug point after committing. The reveal is checked
 *   against the commit hash on-chain.
 * - The operator CAN refuse to reveal. That is why `revealDeadline` exists: past it,
 *   anyone can void the round and every player refunds their full stake.
 * - The multiplier a player sells at is derived from block time, not from anything the
 *   operator says, so a sell cannot be repriced after the fact.
 * - Block timestamps have a few seconds of granularity. A sell is priced at the block
 *   that includes it, so on a congested chain a player may sell lower than the number
 *   they saw. The UI must show that risk rather than hide it.
 */
contract RugRush is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    uint256 private constant ONE = 1e18;

    /// @notice Curve tick. The multiplier steps once per tick of elapsed time.
    uint256 public constant TICK_MS = 100;

    /// @notice Growth per tick: 2^(1/60), so the price doubles every 6 seconds.
    uint256 private constant GROWTH_PER_TICK = 1011619440000000000;

    /// @notice Hard ceiling on the curve — 1200 ticks (120s) is about 2^20.
    uint256 public constant MAX_TICKS = 1200;

    /**
     * @notice House edge. One round in `INSTANT_RUG_DIVISOR` rugs at 1.00x before anyone
     * can sell, which is where the house margin comes from — 1/101 is ~0.99%.
     */
    uint256 public constant INSTANT_RUG_DIVISOR = 101;

    /// @notice Largest share of the bankroll a single round may pay out, in basis points.
    uint256 public constant MAX_ROUND_EXPOSURE_BPS = 2000; // 20%

    enum RoundState {
        None,
        Committed, // seed hash published, bets open
        Running, // curve started, no new bets
        Revealed, // seed published, positions settleable
        Voided // operator missed the reveal, everyone refunds
    }

    struct Round {
        bytes32 serverSeedHash;
        bytes32 serverSeed;
        string clientSeed;
        uint64 startedAt;
        uint64 revealDeadline;
        /// @dev Rug multiplier, 1e18-scaled. Zero until revealed.
        uint256 rugX18;
        uint128 totalStaked;
        uint128 totalPaid;
        RoundState state;
    }

    struct Position {
        uint128 stake;
        /// @dev Sell target set at buy-in; 0 means the player will sell by hand.
        uint256 autoSellX18;
        /// @dev Multiplier the manual sell landed at; 0 if they never sold.
        uint256 soldAtX18;
        /**
         * @dev Payout ceiling, snapshotted at buy-in.
         *
         * The table's ceiling moves with the bankroll, but a player's does not: whatever
         * the table could pay when they bought in is what they are owed. Recomputing it
         * at settlement would quietly shrink a win because someone else won first.
         */
        uint256 maxPayout;
        bool settled;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(uint256 => address[]) private roundPlayers;
    /// @notice Worst-case profit the house is on the hook for in a round.
    mapping(uint256 => uint256) public roundExposure;

    uint256 public roundCount;
    uint256 public bankroll;
    uint256 public minStake;
    uint256 public maxStake;
    /**
     * @notice Hard ceiling on what one position can win, regardless of how far the curve
     * ran. Without it a player riding to 1,000,000x would need a bankroll no table can
     * hold, and every stake would be rejected as over-exposed.
     */
    uint256 public maxPayout;
    /// @notice Seconds the operator has to reveal before a round can be voided.
    uint64 public revealWindow;

    event RoundCommitted(uint256 indexed roundId, bytes32 serverSeedHash, string clientSeed);
    event RoundStarted(uint256 indexed roundId, uint64 startedAt, uint64 revealDeadline);
    event BetPlaced(uint256 indexed roundId, address indexed player, uint128 stake, uint256 autoSellX18);
    event SoldOut(uint256 indexed roundId, address indexed player, uint256 multiplierX18);
    event RoundRevealed(uint256 indexed roundId, bytes32 serverSeed, uint256 rugX18);
    event RoundVoided(uint256 indexed roundId);
    event Settled(uint256 indexed roundId, address indexed player, uint256 payout, bool won);
    event BankrollFunded(address indexed from, uint256 amount);
    event BankrollWithdrawn(address indexed to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        minStake = 0.001 ether;
        maxStake = 100 ether;
        // Kept modest on purpose: the live ceiling is min(maxPayout, 20% of bankroll), so
        // a high value here means one manual seller absorbs the whole round's exposure and
        // nobody else can buy in. Tune it against the bankroll actually funded.
        maxPayout = 10 ether;
        revealWindow = 15 minutes;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // -- Curve ----------------------------------------------------------------------

    /**
     * @notice Multiplier after `elapsedMs` of the launch, 1e18-scaled.
     * @dev Pure and public so a player can check the price their sell will land at
     *      before sending it.
     */
    function multiplierAt(uint256 elapsedMs) public pure returns (uint256) {
        uint256 ticks = elapsedMs / TICK_MS;

        if (ticks > MAX_TICKS) {
            ticks = MAX_TICKS;
        }

        return _pow(GROWTH_PER_TICK, ticks);
    }

    /// @dev Fixed-point exponentiation by squaring. O(log n) multiplications.
    function _pow(uint256 base, uint256 exp) private pure returns (uint256 result) {
        result = ONE;

        while (exp > 0) {
            if (exp & 1 == 1) {
                result = (result * base) / ONE;
            }

            exp >>= 1;

            if (exp > 0) {
                base = (base * base) / ONE;
            }
        }
    }

    /**
     * @notice The rug multiplier a seed pair produces, 1e18-scaled.
     * @dev The client can run this exact computation off-chain to verify a settled round.
     */
    function rugMultiplier(
        bytes32 serverSeed,
        string memory clientSeed,
        uint256 nonce
    ) public pure returns (uint256) {
        uint256 hash = uint256(keccak256(abi.encodePacked(serverSeed, clientSeed, nonce)));

        // The house edge: a slice of rounds rug before anyone can sell.
        if (hash % INSTANT_RUG_DIVISOR == 0) {
            return ONE;
        }

        // Take the top 52 bits and map them onto a 1/x distribution.
        uint256 e = 1 << 52;
        uint256 h = hash >> 204;
        uint256 hundredths = (100 * e - h) / (e - h);

        return hundredths * 1e16;
    }

    // -- Round lifecycle ------------------------------------------------------------

    function commitRound(bytes32 serverSeedHash, string calldata clientSeed)
        external
        onlyOwner
        returns (uint256 roundId)
    {
        require(serverSeedHash != bytes32(0), "Seed hash required");

        roundId = roundCount++;
        Round storage round = rounds[roundId];
        round.serverSeedHash = serverSeedHash;
        round.clientSeed = clientSeed;
        round.state = RoundState.Committed;

        emit RoundCommitted(roundId, serverSeedHash, clientSeed);
    }

    function buyIn(uint256 roundId, uint256 autoSellX18) external payable nonReentrant {
        Round storage round = rounds[roundId];
        require(round.state == RoundState.Committed, "Betting closed");
        require(msg.value >= minStake, "Stake below minimum");
        require(msg.value <= maxStake, "Stake above maximum");
        require(positions[roundId][msg.sender].stake == 0, "Already in this round");
        require(autoSellX18 == 0 || autoSellX18 > ONE, "Auto-sell must exceed 1.00x");

        uint256 tableMax = tableMaxPayout();
        require(tableMax > msg.value, "Stake exceeds table limit");

        // Exposure is the *profit* the house could owe, not the payout: the stake itself
        // funds the first part of any win.
        uint256 worstCase = _payoutFor(
            uint128(msg.value),
            autoSellX18 == 0 ? _maxSellX18() : autoSellX18
        );

        if (worstCase > tableMax) {
            worstCase = tableMax;
        }

        uint256 exposure = worstCase - msg.value;
        uint256 cap = (bankroll * MAX_ROUND_EXPOSURE_BPS) / 10000;
        require(roundExposure[roundId] + exposure <= cap, "Round is full");
        roundExposure[roundId] += exposure;

        positions[roundId][msg.sender] = Position({
            stake: uint128(msg.value),
            autoSellX18: autoSellX18,
            soldAtX18: 0,
            maxPayout: tableMax,
            settled: false
        });
        roundPlayers[roundId].push(msg.sender);
        round.totalStaked += uint128(msg.value);

        emit BetPlaced(roundId, msg.sender, uint128(msg.value), autoSellX18);
    }

    function startRound(uint256 roundId) external onlyOwner {
        Round storage round = rounds[roundId];
        require(round.state == RoundState.Committed, "Round not committed");

        round.startedAt = uint64(block.timestamp);
        round.revealDeadline = uint64(block.timestamp) + revealWindow;
        round.state = RoundState.Running;

        emit RoundStarted(roundId, round.startedAt, round.revealDeadline);
    }

    /**
     * @notice Sell the position at the current price.
     * @dev Priced off block time, so nobody — operator included — can reprice it later.
     */
    function sell(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.state == RoundState.Running, "Round is not running");

        Position storage position = positions[roundId][msg.sender];
        require(position.stake > 0, "No position");
        require(position.soldAtX18 == 0, "Already sold");

        uint256 elapsedMs = (block.timestamp - round.startedAt) * 1000;
        uint256 multiplier = multiplierAt(elapsedMs);
        position.soldAtX18 = multiplier;

        emit SoldOut(roundId, msg.sender, multiplier);
    }

    function revealRound(uint256 roundId, bytes32 serverSeed) external onlyOwner {
        Round storage round = rounds[roundId];
        require(round.state == RoundState.Running, "Round is not running");
        require(keccak256(abi.encodePacked(serverSeed)) == round.serverSeedHash, "Seed mismatch");

        round.serverSeed = serverSeed;
        round.rugX18 = rugMultiplier(serverSeed, round.clientSeed, roundId);
        round.state = RoundState.Revealed;

        emit RoundRevealed(roundId, serverSeed, round.rugX18);
    }

    /// @notice Void a round the operator never revealed. Callable by anyone.
    function voidRound(uint256 roundId) external {
        Round storage round = rounds[roundId];
        require(round.state == RoundState.Running, "Round is not running");
        require(block.timestamp > round.revealDeadline, "Reveal window still open");

        round.state = RoundState.Voided;

        emit RoundVoided(roundId);
    }

    // -- Settlement -----------------------------------------------------------------

    function settle(uint256 roundId) public nonReentrant {
        _settle(roundId, msg.sender);
    }

    /// @notice Settle several players at once, so nobody is stranded if they never return.
    function settleMany(uint256 roundId, address[] calldata players) external nonReentrant {
        for (uint256 i = 0; i < players.length; i++) {
            _settle(roundId, players[i]);
        }
    }

    function _settle(uint256 roundId, address player) private {
        Round storage round = rounds[roundId];
        Position storage position = positions[roundId][player];

        require(position.stake > 0, "No position");
        require(!position.settled, "Already settled");
        require(
            round.state == RoundState.Revealed || round.state == RoundState.Voided,
            "Round not finished"
        );

        position.settled = true;

        // A voided round returns every stake untouched.
        if (round.state == RoundState.Voided) {
            uint256 refund = position.stake;
            round.totalPaid += uint128(refund);
            _send(player, refund);
            emit Settled(roundId, player, refund, false);
            return;
        }

        uint256 exitX18 = _exitMultiplier(position, round.rugX18);

        if (exitX18 == 0) {
            // Rugged while still holding.
            bankroll += position.stake;
            emit Settled(roundId, player, 0, false);
            return;
        }

        uint256 payout = _payoutFor(position.stake, exitX18);

        if (payout > position.maxPayout) {
            payout = position.maxPayout;
        }

        uint256 profit = payout - position.stake;

        require(bankroll >= profit, "Bankroll cannot cover payout");
        bankroll -= profit;
        round.totalPaid += uint128(payout);

        _send(player, payout);
        emit Settled(roundId, player, payout, true);
    }

    /**
     * @dev The price a position actually exited at, or 0 if it never got out.
     *
     * A manual sell wins only if it landed at or below the rug. An auto-sell fires at its
     * target if the rug reached it. When both exist the manual sell wins, because it
     * necessarily happened first — the auto-sell target was never reached.
     */
    function _exitMultiplier(Position storage position, uint256 rugX18)
        private
        view
        returns (uint256)
    {
        if (position.soldAtX18 > 0) {
            return position.soldAtX18 <= rugX18 ? position.soldAtX18 : 0;
        }

        if (position.autoSellX18 > 0 && position.autoSellX18 <= rugX18) {
            return position.autoSellX18;
        }

        return 0;
    }

    function _payoutFor(uint128 stake, uint256 multiplierX18) private pure returns (uint256) {
        return (uint256(stake) * multiplierX18) / ONE;
    }

    /**
     * @notice The most any single position can win right now.
     *
     * @dev The configured `maxPayout` is the house's stated table rule, but it is
     *      meaningless if the bankroll cannot honour it — so the live ceiling is whichever
     *      is smaller. This is what the UI shows as "max win", and it moves as the
     *      bankroll does.
     */
    function tableMaxPayout() public view returns (uint256) {
        uint256 exposureCap = (bankroll * MAX_ROUND_EXPOSURE_BPS) / 10000;

        return maxPayout < exposureCap ? maxPayout : exposureCap;
    }

    /// @dev Ceiling used for exposure checks when a player sets no auto-sell target.
    function _maxSellX18() private pure returns (uint256) {
        return _pow(GROWTH_PER_TICK, MAX_TICKS);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    // -- Views ----------------------------------------------------------------------

    function getRound(uint256 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    function getPlayers(uint256 roundId) external view returns (address[] memory) {
        return roundPlayers[roundId];
    }

    function getPosition(uint256 roundId, address player) external view returns (Position memory) {
        return positions[roundId][player];
    }

    /// @notice Current price of a running round, for clients that would rather ask the chain.
    function currentMultiplier(uint256 roundId) external view returns (uint256) {
        Round storage round = rounds[roundId];

        if (round.state != RoundState.Running) {
            return ONE;
        }

        return multiplierAt((block.timestamp - round.startedAt) * 1000);
    }

    // -- Bankroll -------------------------------------------------------------------

    function fundBankroll() external payable {
        require(msg.value > 0, "Nothing sent");
        bankroll += msg.value;
        emit BankrollFunded(msg.sender, msg.value);
    }

    function withdrawBankroll(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= bankroll, "Exceeds bankroll");
        bankroll -= amount;
        _send(owner(), amount);
        emit BankrollWithdrawn(owner(), amount);
    }

    function setLimits(
        uint256 newMinStake,
        uint256 newMaxStake,
        uint256 newMaxPayout
    ) external onlyOwner {
        require(newMinStake > 0 && newMaxStake >= newMinStake, "Invalid limits");
        require(newMaxPayout >= newMaxStake, "Max payout below max stake");
        minStake = newMinStake;
        maxStake = newMaxStake;
        maxPayout = newMaxPayout;
    }

    function setRevealWindow(uint64 newWindow) external onlyOwner {
        require(newWindow >= 1 minutes, "Window too short");
        revealWindow = newWindow;
    }

    receive() external payable {
        revert("Use fundBankroll");
    }
}
