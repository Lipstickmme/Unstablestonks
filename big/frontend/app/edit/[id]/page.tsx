"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SuccessToast } from "@/components/SuccessToast";
import { CONTRACT_ADDRESS, CATEGORIES, type EventData, sanitizeErrorMessage } from "@/lib/contract";
import { compressImage, fileToBytes, bytesToDataUrl, hexToBytes } from "@/lib/imageCompression";
import { format } from "date-fns";
import { BIG_MARKET_ABI } from "@/lib/abi";

export default function EditPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = BigInt(Number(params.id));
  const { address, isConnected } = useAccount();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Politics");
  const [context, setContext] = useState("");
  const [endTime, setEndTime] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(true);

  const { data: eventData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "getEvent",
    args: [eventId],
  });

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "owner",
  });

  const event = eventData as unknown as EventData | undefined;
  const isOwner = owner && address && typeof owner === 'string' && address.toLowerCase() === owner.toLowerCase();
  const canEdit = isOwner || (event && address && address.toLowerCase() === event.creator.toLowerCase());

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setCategory(event.category);
      setContext(event.context);
      setEndTime(format(new Date(Number(event.endTime) * 1000), "yyyy-MM-dd'T'HH:mm"));
      setOutcomes([...event.outcomes]);
      
      if (event.imageData && event.imageData !== "0x") {
        const imageBytes = hexToBytes(event.imageData);
        setImagePreview(bytesToDataUrl(imageBytes));
      }
      
      setLoading(false);
    }
  }, [event]);

  const [successToast, setSuccessToast] = useState<{ message: string; txHash?: string } | null>(null);

  const { data: hash, writeContract, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: txError } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (writeError) {
      alert(sanitizeErrorMessage(writeError));
    }
  }, [writeError]);

  useEffect(() => {
    if (txError) {
      alert(sanitizeErrorMessage(txError));
    }
  }, [txError]);

  useEffect(() => {
    if (isSuccess && hash) {
      setSuccessToast({ 
        message: "✨ Event updated successfully! Changes are now live on the blockchain!", 
        txHash: hash 
      });
      setTimeout(() => {
        router.push(`/event/${params.id}`);
      }, 2000);
    }
  }, [isSuccess, hash, router, params.id]);

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

    if (!canEdit) {
      alert("You are not authorized to edit this event");
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

    let imageBytes: Uint8Array;
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
    } else if (event?.imageData && event.imageData !== "0x") {
      imageBytes = hexToBytes(event.imageData);
    } else {
      imageBytes = new Uint8Array(0);
    }

    // Final safety check before sending transaction
    if (imageBytes.length > 5120) {
      alert(`Image size validation failed: ${(imageBytes.length / 1024).toFixed(2)}KB. This should not happen. Please try again.`);
      return;
    }

    // Convert to hex string
    const hexString = imageBytes.length > 0 
      ? `0x${Array.from(imageBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`
      : "0x";

    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: BIG_MARKET_ABI,
        functionName: "updateEvent",
        args: [
          eventId,
          title,
          category,
          hexString as `0x${string}`,
          context,
          BigInt(endTimestamp),
          outcomes,
        ],
      });
    } catch (error) {
      console.error("Error updating event:", error);
      alert("Failed to update event");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400">Event not found</p>
          </div>
        </main>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400">You are not authorized to edit this event</p>
          </div>
        </main>
      </div>
    );
  }

  if (event.resolved) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400">Cannot edit resolved events</p>
          </div>
        </main>
      </div>
    );
  }

  if (event.totalPool > 0) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400">Cannot edit events with existing bets</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-6">Edit Event</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">Category *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
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
            <label className="block text-sm font-medium mb-2 text-gray-700">Image (max 5KB)</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
            />
            {compressing && <p className="text-sm text-gray-600 mt-2">Compressing image...</p>}
            {imagePreview && (
              <div className="mt-4">
                <img src={imagePreview} alt="Preview" className="max-w-xs rounded-lg" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">Context *</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">End Time *</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">Outcomes * (at least 2)</label>
            {outcomes.map((outcome, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={outcome}
                  onChange={(e) => handleOutcomeChange(index, e.target.value)}
                  placeholder={`Outcome ${index + 1}`}
                  className="flex-1 px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-gray-900"
                  required
                />
                {outcomes.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveOutcome(index)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddOutcome}
              className="mt-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg"
            >
              Add Outcome
            </button>
          </div>

          <button
            type="submit"
            disabled={isPending || isConfirming}
            className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending || isConfirming ? "Updating..." : "Update Event"}
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

