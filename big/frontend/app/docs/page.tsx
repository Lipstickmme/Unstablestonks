"use client";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 py-12">
        <article className="prose prose-lg max-w-none dark:prose-invert">
          <h1 className="text-5xl font-bold mb-8 font-heading text-gray-900 dark:text-gray-100">What are Prediction Markets?</h1>
          
          <div className="space-y-8 text-gray-700 dark:text-gray-300 leading-relaxed">
            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">Understanding Prediction Markets</h2>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                Prediction markets are platforms where people can bet on the outcome of future events. Think of them as a way to "vote with your money" on what you think will happen. The more people bet on a particular outcome, the higher its probability becomes, creating a collective intelligence system.
              </p>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                Unlike traditional betting, prediction markets aggregate information from many participants, creating more accurate forecasts than any single expert could provide. They've been used to predict everything from election results to weather patterns, and even the success of new products.
              </p>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">Why Prediction Markets Matter</h2>
              <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 dark:border-blue-400 p-6 mb-6 rounded-r-lg">
                <h3 className="text-xl font-semibold mb-3 font-heading text-blue-900 dark:text-blue-300">Collective Intelligence</h3>
                <p className="mb-3 text-gray-700 dark:text-gray-300">
                  When many people bet on outcomes, their combined knowledge creates surprisingly accurate predictions. This "wisdom of the crowd" often outperforms individual experts.
                </p>
                <h3 className="text-xl font-semibold mb-3 font-heading text-blue-900 dark:text-blue-300">Transparency & Decentralization</h3>
                <p className="mb-3 text-gray-700 dark:text-gray-300">
                  Built on blockchain technology, prediction markets are transparent, immutable, and don't require a central authority. Every bet and outcome is recorded on-chain for everyone to see.
                </p>
                <h3 className="text-xl font-semibold mb-3 font-heading text-blue-900 dark:text-blue-300">Financial Incentives</h3>
                <p className="text-gray-700 dark:text-gray-300">
                  People have real money at stake, which motivates them to research and make informed predictions rather than random guesses.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">The Math Made Simple</h2>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                Don't worry - the math is simpler than it sounds! Here's how it works:
              </p>
              
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-6 mb-6">
                <h3 className="text-xl font-semibold mb-3 font-heading text-orange-900 dark:text-orange-300">Probability = Money Ratio</h3>
                <p className="mb-4 text-gray-700 dark:text-gray-300">
                  The probability of an outcome is simply the percentage of total money bet on that outcome:
                </p>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-orange-200 dark:border-orange-800 mb-4">
                  <code className="text-orange-700 dark:text-orange-400 font-mono text-lg">
                    Probability = (Money on Outcome / Total Money) × 100%
                  </code>
                </div>
                <p className="mb-4">
                  <strong>Example:</strong> If $60 is bet on "Yes" and $40 is bet on "No", then:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-4 ml-4">
                  <li>"Yes" probability = (60 / 100) × 100% = <strong>60%</strong></li>
                  <li>"No" probability = (40 / 100) × 100% = <strong>40%</strong></li>
                </ul>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 mb-6">
                <h3 className="text-xl font-semibold mb-3 font-heading text-green-900 dark:text-green-300">How Payouts Work</h3>
                <p className="mb-4 text-gray-700 dark:text-gray-300">
                  When you win, you get a proportional share of the total pool based on how much you bet:
                </p>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-green-200 dark:border-green-800 mb-4">
                  <code className="text-green-700 dark:text-green-400 font-mono text-lg">
                    Your Payout = (Total Pool × Your Stake) / Total Stake on Winning Outcome
                  </code>
                </div>
                <p className="mb-4">
                  <strong>Example:</strong> Total pool is $100, you bet $10 on "Yes" (which wins), and total bet on "Yes" was $60:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-4 ml-4">
                  <li>Your payout = (100 × 10) / 60 = <strong>$16.67</strong></li>
                  <li>You made a profit of $6.67 on your $10 bet! 🎉</li>
                </ul>
                <p className="text-sm text-gray-600">
                  Note: A 2% platform fee is deducted when you place a bet, so only 98% of your bet goes into the pool.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">The Smart Contract</h2>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                Our prediction market runs on a <strong>smart contract</strong> - a self-executing program stored on the blockchain. Think of it as a digital vending machine that automatically handles all bets and payouts.
              </p>
              
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-6 mb-6">
                <h3 className="text-xl font-semibold mb-3 font-heading text-purple-900 dark:text-purple-300">Key Features:</h3>
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <span className="text-purple-600 dark:text-purple-400 mr-2">✓</span>
                    <span className="text-gray-700 dark:text-gray-300"><strong>Transparent:</strong> All bets and outcomes are publicly visible on the blockchain</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-600 dark:text-purple-400 mr-2">✓</span>
                    <span className="text-gray-700 dark:text-gray-300"><strong>Trustless:</strong> No need to trust a central authority - the code enforces the rules</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-600 dark:text-purple-400 mr-2">✓</span>
                    <span className="text-gray-700 dark:text-gray-300"><strong>Automatic:</strong> Payouts are calculated and distributed automatically when events resolve</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-600 dark:text-purple-400 mr-2">✓</span>
                    <span className="text-gray-700 dark:text-gray-300"><strong>Upgradeable:</strong> The contract can be improved over time while maintaining security</span>
                  </li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">What Can Be Predicted?</h2>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                <strong>Almost anything!</strong> Prediction markets can be created for any future event with clear, verifiable outcomes. Here are some examples:
              </p>
              
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">📊 Politics</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Election results, policy decisions, political events</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">⚽ Sports</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Game outcomes, championship winners, player performance</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">💻 Technology</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Product launches, stock prices, tech trends</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">🎬 Entertainment</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Award winners, box office results, celebrity events</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">🌍 World Events</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Economic indicators, natural disasters, global trends</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">📱 Social Media</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Viral trends, platform changes, influencer events</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">How It Works / How to Play</h2>
              
              <div className="space-y-6">
                <div className="border-l-4 border-orange-500 dark:border-orange-400 pl-6">
                  <h3 className="text-xl font-semibold mb-2 font-heading text-gray-900 dark:text-gray-100">Step 1: Connect Your Wallet</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Click "Connect Wallet" in the top right corner. You'll need a crypto wallet like MetaMask with some POL tokens (on Polygon mainnet) to get started.
                  </p>
                </div>

                <div className="border-l-4 border-blue-500 dark:border-blue-400 pl-6">
                  <h3 className="text-xl font-semibold mb-2 font-heading text-gray-900 dark:text-gray-100">Step 2: Browse Events</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Explore the homepage to see all available prediction markets. Use the category buttons to filter by topic, or search for specific events.
                  </p>
                </div>

                <div className="border-l-4 border-green-500 dark:border-green-400 pl-6">
                  <h3 className="text-xl font-semibold mb-2 font-heading text-gray-900 dark:text-gray-100">Step 3: Place Your Stake</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Click on an event to see details and probabilities. Choose your outcome (Yes/No or multiple options), enter your bet amount, and confirm the transaction. Remember: a 2% platform fee applies.
                  </p>
                </div>

                <div className="border-l-4 border-purple-500 dark:border-purple-400 pl-6">
                  <h3 className="text-xl font-semibold mb-2 font-heading text-gray-900 dark:text-gray-100">Step 4: Wait for Resolution</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    Once the event's end time passes, the owner can resolve it by selecting the winning outcome. This is done on-chain and is permanent.
                  </p>
                </div>

                <div className="border-l-4 border-yellow-500 dark:border-yellow-400 pl-6">
                  <h3 className="text-xl font-semibold mb-2 font-heading text-gray-900 dark:text-gray-100">Step 5: Claim Your Winnings</h3>
                  <p className="text-gray-700 dark:text-gray-300">
                    If you bet on the winning outcome, you can claim your proportional payout. Click "Claim Payout" and the funds will be automatically transferred to your wallet!
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">Creating Events</h2>
              <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
                Only authorized creators (the owner or whitelisted addresses) can create events. To create one:
              </p>
              <ol className="list-decimal list-inside space-y-3 ml-4 text-gray-700 dark:text-gray-300">
                <li>Go to the "Create" page</li>
                <li>Fill in the event details: title, category, description, end time</li>
                <li>Add at least 2 possible outcomes (e.g., "Yes" and "No")</li>
                <li>Optionally upload an image (automatically compressed to 5KB)</li>
                <li>Submit and confirm the transaction</li>
              </ol>
            </section>

            <section className="bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-8">
              <h2 className="text-3xl font-bold mb-4 font-heading text-gray-900 dark:text-gray-100">Ready to Start?</h2>
              <p className="text-lg mb-6 text-gray-700 dark:text-gray-300">
                Prediction markets are a powerful way to tap into collective intelligence and potentially profit from your insights. Start by exploring existing events, or if you're authorized, create your own market!
              </p>
              <div className="flex gap-4">
                <a
                  href="/"
                  className="px-6 py-3 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 dark:hover:bg-orange-600 text-white rounded-lg font-semibold transition-colors"
                >
                  Browse Events
                </a>
                <a
                  href="/create"
                  className="px-6 py-3 bg-white dark:bg-gray-800 border-2 border-orange-600 dark:border-orange-500 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg font-semibold transition-colors"
                >
                  Create Event
                </a>
              </div>
            </section>
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

