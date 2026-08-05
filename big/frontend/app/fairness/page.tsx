"use client";

import { useMemo, useState } from "react";

import { verifyRound } from "@/lib/games/crash/fairness";
import { generateToken } from "@/lib/games/crash/tokens";

const isBytes32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

/**
 * Independent verifier for a settled RugRush round.
 *
 * Everything here runs in the browser against the same derivation the contract uses, so a
 * player can check a round without trusting this app, our RPC, or our word for it. The
 * inputs all come off-chain events, which anyone can read themselves.
 */
export default function FairnessPage() {
  const [serverSeed, setServerSeed] = useState("");
  const [serverSeedHash, setServerSeedHash] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("0");
  const [reportedRug, setReportedRug] = useState("");

  const ready = isBytes32(serverSeed) && isBytes32(serverSeedHash) && nonce !== "";

  const result = useMemo(() => {
    if (!ready) {
      return null;
    }

    const reported = reportedRug.trim()
      ? BigInt(Math.round(Number(reportedRug) * 100)) * 10n ** 16n
      : undefined;

    return verifyRound({
      serverSeed: serverSeed as `0x${string}`,
      serverSeedHash: serverSeedHash as `0x${string}`,
      clientSeed,
      nonce: BigInt(nonce),
      reportedRugX18: reported,
    });
  }, [ready, serverSeed, serverSeedHash, clientSeed, nonce, reportedRug]);

  const token = useMemo(() => {
    if (!isBytes32(serverSeedHash)) {
      return null;
    }

    return generateToken(serverSeedHash, clientSeed, BigInt(nonce || "0"));
  }, [serverSeedHash, clientSeed, nonce]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold">Verify a round</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
        Paste the values from a round&apos;s <code>RoundCommitted</code> and{" "}
        <code>RoundRevealed</code> events. The check runs entirely in your browser.
      </p>

      <div className="mt-6 space-y-4">
        <Field
          label="Server seed (revealed)"
          value={serverSeed}
          onChange={setServerSeed}
          placeholder="0x…"
          error={serverSeed !== "" && !isBytes32(serverSeed) ? "Expected 32 bytes" : null}
        />
        <Field
          label="Server seed hash (committed before betting)"
          value={serverSeedHash}
          onChange={setServerSeedHash}
          placeholder="0x…"
          error={
            serverSeedHash !== "" && !isBytes32(serverSeedHash) ? "Expected 32 bytes" : null
          }
        />
        <Field label="Client seed" value={clientSeed} onChange={setClientSeed} placeholder="" />
        <Field label="Round number (nonce)" value={nonce} onChange={setNonce} placeholder="0" />
        <Field
          label="Reported rug multiplier (optional)"
          value={reportedRug}
          onChange={setReportedRug}
          placeholder="e.g. 2.47"
        />
      </div>

      {result && (
        <section className="mt-8 space-y-3 rounded-xl border border-gray-200 p-5 dark:border-white/10">
          <Row
            label="Seed matches the commit"
            ok={result.matchesCommit}
            detail={
              result.matchesCommit
                ? "The revealed seed hashes to the value published before betting opened."
                : "This seed does NOT hash to the published commit. Do not trust this round."
            }
          />

          <div className="flex items-baseline justify-between border-t border-gray-200 pt-3 dark:border-white/10">
            <span className="text-sm text-gray-500 dark:text-neutral-400">
              Rug multiplier from these inputs
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {result.rug.toFixed(2)}×
            </span>
          </div>

          {result.reportedRug !== undefined && (
            <Row
              label="Matches the reported result"
              ok={result.agrees}
              detail={
                result.agrees
                  ? "The payout multiplier matches the derivation."
                  : `Derived ${result.rug.toFixed(2)}× but the round reported ${result.reportedRug.toFixed(2)}×.`
              }
            />
          )}
        </section>
      )}

      {token && (
        <section className="mt-6 rounded-xl border border-gray-200 p-5 dark:border-white/10">
          <p className="mb-2 text-sm font-semibold">Token this round would have launched</p>
          <p className="text-sm">
            {token.emoji} {token.name} <span className="text-gray-400">{token.ticker}</span>
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400">
            Derived from the commit hash alone, which is why it can be shown before the
            round runs — and why it cannot tell you anything about the rug.
          </p>
        </section>
      )}

      <section className="mt-8 rounded-xl border border-gray-200 p-5 text-sm dark:border-white/10">
        <h2 className="mb-2 font-semibold">How the number is derived</h2>
        <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5">
          {`hash = keccak256(abi.encodePacked(serverSeed, clientSeed, nonce))

if hash % 101 == 0:            # the house edge, ~0.99%
    rug = 1.00

else:
    e   = 2**52
    h   = hash >> 204          # top 52 bits
    rug = (100 * e - h) / (e - h) / 100`}
        </pre>
        <p className="mt-3 text-xs text-gray-500 dark:text-neutral-400">
          The same code runs in <code>RugRush.rugMultiplier</code> on-chain and in{" "}
          <code>lib/games/crash/fairness.ts</code> here.
        </p>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500 dark:text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/10"
      />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        <span className={`text-sm font-semibold ${ok ? "text-emerald-500" : "text-red-500"}`}>
          {ok ? "✓ verified" : "✗ mismatch"}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{detail}</p>
    </div>
  );
}
