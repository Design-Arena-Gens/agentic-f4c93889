"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "initiator" | "responder";

type Message = {
  id: string;
  text: string;
  sender: "me" | "peer";
  at: Date;
};

const encodeDescription = (desc: RTCSessionDescriptionInit | null) => {
  if (!desc) return "";
  return btoa(JSON.stringify(desc));
};

const decodeDescription = (code: string): RTCSessionDescriptionInit => {
  const json = atob(code.trim());
  return JSON.parse(json);
};

const waitForIceGathering = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const handler = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", handler);
  });

const createPeer = (servers: RTCIceServer[]) =>
  new RTCPeerConnection({
    iceServers: servers,
    iceCandidatePoolSize: 8,
  });

function OfflineMessenger() {
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState("শুরু করার জন্য ভূমিকা নির্বাচন করুন");
  const [localCode, setLocalCode] = useState("");
  const [remoteCode, setRemoteCode] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [channelReady, setChannelReady] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const reset = useCallback(() => {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    dataChannelRef.current = null;
    pcRef.current = null;
    setRole(null);
    setStatus("শুরু করার জন্য ভূমিকা নির্বাচন করুন");
    setLocalCode("");
    setRemoteCode("");
    setMessages([]);
    setInput("");
    setChannelReady(false);
  }, []);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      setChannelReady(true);
      setStatus("সংযোগ প্রস্তুত। এখন বার্তা পাঠাতে পারবেন।");
    };
    channel.onclose = () => {
      setChannelReady(false);
      setStatus("চ্যানেল বন্ধ হয়েছে। পুনরায় শুরু করুন।");
    };
    channel.onerror = () => {
      setStatus("চ্যানেলে সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।");
    };
    channel.onmessage = (event) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text: event.data as string,
          sender: "peer",
          at: new Date(),
        },
      ]);
    };
  }, []);

  useEffect(() => {
    return () => {
      dataChannelRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  const startSession = useCallback(
    async (selectedRole: Role) => {
      reset();
      setRole(selectedRole);
      setStatus("সংযোগ প্রস্তুত করা হচ্ছে...");

      const pc = createPeer([]);
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setStatus("সংযোগ ব্যর্থ হয়েছে। পুনরায় চেষ্টা করুন।");
          setChannelReady(false);
        }
      };

      pc.onicecandidate = () => {
        setLocalCode(encodeDescription(pc.localDescription));
      };

      if (selectedRole === "initiator") {
        const dataChannel = pc.createDataChannel("mesh-chat", {
          ordered: true,
        });
        setupDataChannel(dataChannel);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        setLocalCode(encodeDescription(pc.localDescription));
        setStatus("বোঝাপড়া কোড রেডি। অপর পক্ষকে দিন।");
      } else {
        pc.ondatachannel = (event) => {
          setupDataChannel(event.channel);
        };
        setStatus("অপর পক্ষের বোঝাপড়া কোড পেস্ট করুন।");
      }
    },
    [reset, setupDataChannel]
  );

  const submitRemoteCode = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteCode.trim()) return;

    try {
      const description = decodeDescription(remoteCode);
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(description);
      }

      if (role === "responder" && !pc.currentLocalDescription) {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);
        setLocalCode(encodeDescription(pc.localDescription));
        setStatus("আপনার কোড রেডি। অপর পক্ষকে দিন।");
      } else if (role === "initiator") {
        setStatus("সংযোগ চূড়ান্ত হচ্ছে...");
      }
    } catch {
      setStatus("কোড সঠিক নয়। আবার চেষ্টা করুন।");
    }
  }, [remoteCode, role]);

  const sendMessage = useCallback(() => {
    if (!channelReady || !input.trim()) return;
    const channel = dataChannelRef.current;
    if (!channel) return;
    const text = input.trim();
    channel.send(text);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, sender: "me", at: new Date() },
    ]);
    setInput("");
  }, [channelReady, input]);

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-zinc-900">
          অফলাইন মেসেজিং (ইন্টারনেট ছাড়া)
        </h2>
        <p className="text-sm text-zinc-500">
          একই নেটওয়ার্কে থাকলে ম্যানুয়াল কোড বিনিময় করে ডেটা চ্যানেল তৈরি করুন।
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startSession("initiator")}
          className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          আমি শুরু করবো
        </button>
        <button
          type="button"
          onClick={() => startSession("responder")}
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          আমি যোগ দেব
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-red-200 bg-red-50 px-5 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          রিসেট
        </button>
      </div>

      <p className="mt-2 text-sm font-medium text-indigo-600">{status}</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-600">
          আপনার কোড
          <textarea
            readOnly
            value={localCode}
            className="min-h-[140px] rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-600">
          অপর পক্ষের কোড পেস্ট করুন
          <textarea
            value={remoteCode}
            onChange={(event) => setRemoteCode(event.target.value)}
            className="min-h-[140px] rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-700"
          />
          <button
            type="button"
            onClick={submitRemoteCode}
            className="mt-1 w-fit rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            কোড প্রয়োগ করুন
          </button>
        </label>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-900">
            চ্যাট হিস্ট্রি
          </h3>
          <span
            className={`text-sm font-medium ${channelReady ? "text-emerald-600" : "text-zinc-400"}`}
          >
            {channelReady ? "সংযুক্ত" : "অপেক্ষমান"}
          </span>
        </div>
        <div className="mt-3 h-64 overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-400">
              সংযোগ তৈরি হলে এখানে বার্তা দেখতে পাবেন।
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`flex ${message.sender === "me" ? "justify-end" : "justify-start"}`}
                >
                  <span
                    className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow ${message.sender === "me" ? "bg-indigo-600 text-white" : "bg-white text-zinc-800"}`}
                  >
                    {message.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="আপনার বার্তা লিখুন…"
            className="flex-1 rounded-full border border-zinc-200 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!channelReady || !input.trim()}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            পাঠান
          </button>
        </div>
      </div>
    </section>
  );
}

type CallState = "idle" | "await-offer" | "await-answer" | "connected" | "error";

function OnlineCall() {
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<CallState>("idle");
  const [localCode, setLocalCode] = useState("");
  const [remoteCode, setRemoteCode] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const tearDown = useCallback(() => {
    pcRef.current?.getSenders().forEach((sender) => {
      try {
        sender.track?.stop();
      } catch {
        /* ignore */
      }
    });
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setRole(null);
    setStatus("idle");
    setLocalCode("");
    setRemoteCode("");
    setError(null);
  }, [localStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(
    () => () => {
      tearDown();
    },
    [tearDown]
  );

  const ensureMedia = useCallback(async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(media);
      return media;
    } catch (err) {
      setError("ক্যামেরা/মাইক্রোফোন এক্সেস পাওয়া যায়নি।");
      throw err;
    }
  }, []);

  const preparePeer = useCallback(() => {
    const pc = createPeer([
      { urls: ["stun:stun.l.google.com:19302"] },
      { urls: ["stun:stun1.l.google.com:19302"] },
    ]);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("connected");
      }
      if (pc.connectionState === "failed") {
        setStatus("error");
        setError("কল ব্যর্থ হয়েছে।");
      }
    };

    pc.onicecandidate = () => {
      setLocalCode(encodeDescription(pc.localDescription));
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
      }
    };

    return pc;
  }, []);

  const startCall = useCallback(
    async (selectedRole: Role) => {
      tearDown();
      setRole(selectedRole);
      setStatus(selectedRole === "initiator" ? "await-answer" : "await-offer");
      setError(null);

      const media = await ensureMedia();
      const pc = preparePeer();

      media.getTracks().forEach((track) => {
        pc.addTrack(track, media);
      });

      if (selectedRole === "initiator") {
        const offer = await pc.createOffer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true,
        });
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        setLocalCode(encodeDescription(pc.localDescription));
      } else {
        setStatus("await-offer");
      }
    },
    [ensureMedia, preparePeer, tearDown]
  );

  const applyRemoteCode = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteCode.trim()) return;

    try {
      const description = decodeDescription(remoteCode);
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(description);
      }

      if (role === "responder" && !pc.currentLocalDescription) {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);
        setLocalCode(encodeDescription(pc.localDescription));
        setStatus("await-answer");
      } else if (role === "initiator") {
        setStatus("connected");
      }
    } catch (err) {
      console.error(err);
      setError("কোড সঠিক নয় বা প্রক্রিয়া ব্যাহত হয়েছে।");
      setStatus("error");
    }
  }, [remoteCode, role]);

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-zinc-900">
          অনলাইন অডিও/ভিডিও কল
        </h2>
        <p className="text-sm text-zinc-500">
          ইন্টারনেট থাকলে স্টান সার্ভার ব্যবহার করে দ্রুত কল করুন। কোড বিনিময়
          স্বয়ংক্রিয় সিগনালিংয়ের বিকল্প।
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startCall("initiator")}
          className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          আমি কল শুরু করবো
        </button>
        <button
          type="button"
          onClick={() => startCall("responder")}
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          আমি কল রিসিভ করবো
        </button>
        <button
          type="button"
          onClick={tearDown}
          className="rounded-full border border-red-200 bg-red-50 px-5 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          কল শেষ করুন
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="font-medium text-zinc-600">স্ট্যাটাস:</span>
        <span
          className={`font-semibold ${status === "connected" ? "text-emerald-600" : status === "error" ? "text-red-600" : "text-indigo-600"}`}
        >
          {status === "idle" && "প্রথমে ভূমিকা নির্বাচন করুন"}
          {status === "await-offer" && "অপর পক্ষের অফার কোডের অপেক্ষায়"}
          {status === "await-answer" && "কোড শেয়ার করুন / অপর পক্ষের উত্তরের অপেক্ষায়"}
          {status === "connected" && "কল সংযুক্ত"}
          {status === "error" && "সমস্যা হয়েছে"}
        </span>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-600">
          আপনার কোড
          <textarea
            readOnly
            value={localCode}
            className="min-h-[140px] rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-zinc-600">
          অপর পক্ষের কোড পেস্ট করুন
          <textarea
            value={remoteCode}
            onChange={(event) => setRemoteCode(event.target.value)}
            className="min-h-[140px] rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-700"
          />
          <button
            type="button"
            onClick={applyRemoteCode}
            className="mt-1 w-fit rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            কোড প্রয়োগ করুন
          </button>
        </label>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-600">আপনার ভিডিও</span>
          <div className="aspect-video overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900">
            <video
              ref={localVideoRef}
              playsInline
              autoPlay
              muted
              className="h-full w-full object-cover"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-600">
            অপর পক্ষের ভিডিও
          </span>
          <div className="aspect-video overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900">
            <video
              ref={remoteVideoRef}
              playsInline
              autoPlay
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const sessionTips = useMemo(
    () => [
      "বোঝাপড়া কোড শেয়ার করার সময় QR কোড বা অফলাইন সংবাদের মাধ্যমে বিনিময় করুন।",
      "অফলাইন মেসেজিং শুধুমাত্র একই নেটওয়ার্কে কাজ করবে এবং ইন্টারনেটের উপর নির্ভর করে না।",
      "কলের আগে ক্যামেরা ও মাইক্রোফোন অনুমতি নিশ্চিত করুন।",
    ],
    []
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-zinc-100 via-white to-zinc-200 py-12 text-zinc-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
        <header className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-semibold text-zinc-900 md:text-4xl">
            হাইব্রিড মেসেঞ্জার
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-500 md:text-base">
            ইন্টারনেট ছাড়াই চ্যাট করুন, আর যখন সংযোগ থাকে তখন এই অ্যাপ থেকে
            সরাসরি অডিও/ভিডিও কল করুন। নিচের ধাপগুলো অনুসরণ করে নিরাপদভাবে
            সংযোগ গড়ে তুলুন।
          </p>
          <ul className="mt-4 grid gap-2 text-sm text-zinc-600 md:grid-cols-3 md:gap-4">
            {sessionTips.map((tip) => (
              <li
                key={tip}
                className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4"
              >
                {tip}
              </li>
            ))}
          </ul>
        </header>

        <OfflineMessenger />
        <OnlineCall />
      </div>
    </main>
  );
}

