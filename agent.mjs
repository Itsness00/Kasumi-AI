// Kasumiai FaceTime Video & Audio Agent (Chert <-> LiveKit <-> Yukari/Hermes/Gemini + ElevenLabs)
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';

const BRIDGE_BASE_URL = (process.env.YUKARI_BRIDGE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || '';
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID || 'cgSgspJ2msm6clMCkdW9';
const ELEVEN_MODEL = process.env.ELEVEN_MODEL || 'eleven_flash_v2_5';
const IDLE_CHECKIN_MS = Number(process.env.IDLE_CHECKIN_MS || 30_000);

const instructions = `You are Kasumiai, Ernesto's quick, intelligent AI companion in the Yukari system on a live iPhone FaceTime call via Chert.
Listen carefully to every command and respond quickly, clearly, and concisely: give 1 to 3 short, informative sentences with concrete details.
Never use markdown symbols, bullet points, or filler phrases because your words are spoken aloud in real time.
When Ernesto asks to open an app, check his Windows 11 laptop, or check Gemini tokens / ElevenLabs voice quota, execute or report the live result clearly.`;

const greetingInstruction =
  'Greet Ernesto warmly in one short crisp sentence as Kasumiai and let him know you are online and listening.';

const agent = defineAgent({
  entry: async ctx => {
    if (!HERMES_API_KEY || !ELEVEN_API_KEY) {
      throw new Error('Missing HERMES_API_KEY or ELEVEN_API_KEY in .env.local');
    }

    // Native SFU autoSubscribe=true so caller's microphone track is ALWAYS subscribed immediately!
    await ctx.connect();
    // Wait until a real FaceTime caller arrives before opening paid STT/TTS streams or publishing video
    const caller = await ctx.waitForParticipant();

    // Publish HD 960x540 @ 20fps Kasumiai Neural Core camera track from this same speaking participant
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('kasumiai-hd-video', source);
    let tick = 0;
    let speaking = false;
    let agentMode = 'listening';

    const renderFrame = () => {
      const rgba = drawFace(tick++, speaking, agentMode);
      source.captureFrame(new VideoFrame(rgba, WIDTH, HEIGHT, VideoBufferType.RGBA));
    };
    renderFrame();
    const pubOpts = new TrackPublishOptions();
    pubOpts.source = TrackSource.SOURCE_CAMERA;
    await ctx.room.localParticipant.publishTrack(track, pubOpts);
    const videoTimer = setInterval(renderFrame, Math.round(1000 / FPS));

    // Cloud GPU turn detection via ElevenLabs Scribe v2 Realtime serverVad:
    // eliminates local ONNX CPU lag ("inference is slower than realtime") and commits speech in ~0.6s!
    const ttsEngine = new elevenlabs.TTS({
      apiKey: ELEVEN_API_KEY,
      voiceId: ELEVEN_VOICE_ID,
      model: ELEVEN_MODEL,
      encoding: 'pcm_24000',
      language: 'en',
      streamingLatency: 4,
      syncAlignment: false,
      voiceSettings: {
        stability: 0.52,
        similarity_boost: 0.82,
        style: 0.0,
        use_speaker_boost: true,
      },
    });
    // Pre-open ElevenLabs multi-stream WebSocket immediately so first & subsequent replies have zero TLS/WS startup lag
    ttsEngine.currentConnection().catch(() => {});

    const session = new voice.AgentSession({
      vad: null,
      turnDetection: 'stt',
      aecWarmupDuration: 1.5,
      minEndpointingDelay: 0.04,
      maxEndpointingDelay: 0.18,
      stt: new elevenlabs.STT({
        apiKey: ELEVEN_API_KEY,
        model: 'scribe_v2_realtime',
        languageCode: 'en',
        serverVad: {
          vadSilenceThresholdSecs: 0.48,
          vadThreshold: 0.48,
          minSpeechDurationMs: 110,
          minSilenceDurationMs: 340,
        },
      }),
      llm: new openai.LLM({
        model: 'gemini-3.8-flash',
        baseURL: `${BRIDGE_BASE_URL}/v1`,
        apiKey: HERMES_API_KEY,
        temperature: 0.65,
      }),
      tts: ttsEngine,
    });

    // Track user & agent states for synced visuals + 30-second idle check-in
    let bridgeReadyReached = false;
    let userIsSpeaking = false;
    let lastActivityAt = Date.now();
    let idleCheckSentSinceLastSpeech = false;

    const markActivity = (resetIdleFlag = false) => {
      lastActivityAt = Date.now();
      if (resetIdleFlag) {
        idleCheckSentSinceLastSpeech = false;
      }
    };

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, ev => {
      speaking = ev.newState === 'speaking';
      agentMode = ev.newState === 'speaking' ? 'speaking' : ev.newState === 'thinking' ? 'thinking' : 'listening';
      markActivity(false);
    });

    session.on(voice.AgentSessionEventTypes.UserStateChanged, ev => {
      userIsSpeaking = ev.newState === 'speaking';
      markActivity(ev.newState === 'speaking');
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, ev => {
      console.log('[kasumiai-transcript]', JSON.stringify(ev));
      if (ev.transcript && ev.transcript.trim()) {
        markActivity(true);
      }
    });

    // 30-second idle check-in ("Are you still there?")
    const idleTimer = setInterval(() => {
      if (!bridgeReadyReached) return;
      if (speaking || agentMode === 'thinking' || userIsSpeaking) {
        lastActivityAt = Date.now();
        return;
      }
      if (!idleCheckSentSinceLastSpeech && Date.now() - lastActivityAt >= IDLE_CHECKIN_MS) {
        idleCheckSentSinceLastSpeech = true;
        lastActivityAt = Date.now();
        try {
          session.say(
            'Hey Ernesto, are you still there? Just let me know whenever you are ready for your next command.',
            { allowInterruptions: true }
          );
        } catch {
          // Call may have already disconnected
        }
      }
    }, 1500);

    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: {
        audioEnabled: true,
        transcriptionEnabled: false,
      },
    });

    if (session.activity?.schedulingPaused) {
      try {
        await session._updateActivity(new voice.Agent({ instructions }), { waitOnEnter: false });
      } catch (actErr) {
        console.error('[kasumiai] _updateActivity error:', actErr);
      }
    }

    // Greet once as soon as Chert reports FaceTime bridge_ready (within 10s deadline),
    // using direct TTS session.say() so greeting starts in ~0.3s and never misses Chert's 10s timeout.
    const sayGreeting = () => {
      bridgeReadyReached = true;
      markActivity(true);
      session.say('Hi Ernesto, Kasumiai is online and listening. What can I do for you?', {
        allowInterruptions: true,
      });
    };
    let stopGreeting = () => {};
    if (caller.identity.startsWith('chert-bridge-')) {
      stopGreeting = greetOnBridgeReady(ctx.room, sayGreeting);
    } else {
      sayGreeting();
    }

    ctx.addShutdownCallback(async () => {
      stopGreeting();
      clearInterval(idleTimer);
      clearInterval(videoTimer);
      await session.close();
      await track.close();
      await source.close();
    });
  },
});

export default agent;

runAgent(agent, {
  file: fileURLToPath(import.meta.url),
  agentName: process.env.AGENT_NAME || 'yukari-kasumiai',
});
