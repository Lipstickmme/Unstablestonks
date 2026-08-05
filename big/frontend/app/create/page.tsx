"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SuccessToast } from "@/components/SuccessToast";
import { CONTRACT_ADDRESS, CATEGORIES, sanitizeErrorMessage } from "@/lib/contract";
import { compressImage, fileToBytes } from "@/lib/imageCompression";
import { BIG_MARKET_ABI } from "@/lib/abi";

export default function CreatePage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Politics");
  const [context, setContext] = useState("");
  const [endTime, setEndTime] = useState("");
  const [outcomes, setOutcomes] = useState(["Yes", "No"]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{ message: string; txHash?: string } | null>(null);

  const { data: hash, writeContract, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt, error: txError } = useWaitForTransactionReceipt({ 
    hash: hash as `0x${string}` | undefined,
  });

  useEffect(() => {
    if (writeError) {
      setErrorMessage(sanitizeErrorMessage(writeError));
    }
  }, [writeError]);

  useEffect(() => {
    if (txError) {
      setErrorMessage(sanitizeErrorMessage(txError));
    }
  }, [txError]);

  useEffect(() => {
    if (hash) {
      setTxHash(hash);
      setSuccessMessage("Transaction submitted! Waiting for confirmation...");
    }
  }, [hash]);

  useEffect(() => {
    if (isSuccess && receipt) {
      setSuccessToast({ 
        message: "🎊 Event created successfully! Your prediction market is now live!", 
        txHash: receipt.transactionHash 
      });
      setSuccessMessage("Event created successfully! Redirecting...");
      setTxHash(receipt.transactionHash);
      // Wait a bit for blockchain to update, then redirect
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 3000);
    }
  }, [isSuccess, receipt, router]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    try {
      const compressed = await compressImage(file, 5);
      const sizeKB = (compressed.size / 1024).toFixed(2);
      console.log(`Final compressed size: ${compressed.size} bytes (${sizeKB}KB)`);
      
      // Double-check size before setting (match compression buffer of 5020)
      if (compressed.size > 5020) {
        alert(`Image is still too large after compression: ${sizeKB}KB (max 5KB). Please try a different image.`);
        setCompressing(false);
        return;
      }
      
      setImageFile(compressed);
      const preview = URL.createObjectURL(compressed);
      setImagePreview(preview);
    } catch (error) {
      console.error("Compression error:", error);
      alert("Failed to compress image. Please try a different image.");
    } finally {
      setCompressing(false);
    }
  };

  const handleAddOutcome = () => {
    setOutcomes([...outcomes, ""]);
  };

  const handleOutcomeChange = (index: number, value: string) => {
    const newOutcomes = [...outcomes];
    newOutcomes[index] = value;
    setOutcomes(newOutcomes);
  };

  const handleRemoveOutcome = (index: number) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected) {
      alert("Please connect your wallet");
      return;
    }

    if (!title || !category || !context || !endTime) {
      alert("Please fill in all required fields");
      return;
    }

    if (outcomes.some((o) => !o.trim())) {
      alert("All outcomes must have a value");
      return;
    }

    if (outcomes.length < 2) {
      alert("At least 2 outcomes are required");
      return;
    }

    const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000);
    if (endTimestamp <= Date.now() / 1000) {
      alert("End time must be in the future");
      return;
    }

    let imageBytes: Uint8Array = new Uint8Array(0);
    if (imageFile) {
      try {
        imageBytes = await fileToBytes(imageFile);
        console.log(`Image size after compression: ${imageBytes.length} bytes (max: 5020 bytes)`);
        // Match the compression buffer - reject anything over 5020 bytes
        if (imageBytes.length > 5020) {
          alert(`Image is too large: ${(imageBytes.length / 1024).toFixed(2)}KB (max 5KB). Please try a different image.`);
          return;
        }
      } catch (error) {
        console.error("Error converting image:", error);
        alert("Failed to process image");
        return;
      }
    }

    // Convert to hex string
    const hexString = imageBytes.length > 0 
      ? `0x${Array.from(imageBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`
      : "0x";

    // Final safety check before sending transaction
    if (imageBytes.length > 5120) {
      alert(`Image size validation failed: ${(imageBytes.length / 1024).toFixed(2)}KB. This should not happen. Please try again.`);
      return;
    }

    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: BIG_MARKET_ABI,
        functionName: "createEvent",
        args: [title, category, hexString as `0x${string}`, context, BigInt(endTimestamp), outcomes],
      });
    } catch (error) {
      console.error("Error creating event:", error);
      alert("Failed to create event");
    }
  };

  // Redirect handled in useEffect when transaction succeeds

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Please connect your wallet to create events</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
        <h1 className="text-3xl font-bold mb-6 font-heading">Create Event</h1>

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-green-700 dark:text-green-400 font-medium">{successMessage}</p>
            {txHash && (
              <a
                href={`https://polygonscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 dark:text-green-400 text-sm underline mt-2 block"
              >
                View on Polygonscan: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-700 dark:text-red-400 font-medium">{errorMessage}</p>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-red-600 dark:text-red-400 text-sm underline mt-2"
            >
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
              required
            >
              {CATEGORIES.filter((c) => c !== "All").map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Image (max 5KB)</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
            />
            {compressing && <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Compressing image...</p>}
            {imagePreview && imageFile && (
              <div className="mt-4">
                <img src={imagePreview} alt="Preview" className="max-w-xs rounded-lg" />
                <p className={`text-sm mt-2 ${imageFile.size > 5120 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  Size: {(imageFile.size / 1024).toFixed(2)}KB / 5KB max
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Context *</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">End Time *</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Outcomes * (at least 2)</label>
            {outcomes.map((outcome, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={outcome}
                  onChange={(e) => handleOutcomeChange(index, e.target.value)}
                  placeholder={`Outcome ${index + 1}`}
                  className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 text-gray-900 dark:text-gray-100"
                  required
                />
                {outcomes.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveOutcome(index)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white rounded-lg"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddOutcome}
              className="mt-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              Add Outcome
            </button>
          </div>

          <button
            type="submit"
            disabled={isPending || isConfirming}
            className="w-full px-6 py-3 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 dark:hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending || isConfirming ? "Creating..." : "Create Event"}
          </button>
        </form>

        {successToast && (
          <SuccessToast
            message={successToast.message}
            txHash={successToast.txHash}
            onClose={() => setSuccessToast(null)}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

