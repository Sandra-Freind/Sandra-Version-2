import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getSandraErrorMessage,
  sendSandraMessage,
  translateSandraRecording,
} from '@/lib/sandraApi';
import {
  loadChatHistory,
  saveChatHistory,
  type StoredChatMessage,
} from '@/lib/chatStorage';

type Message = StoredChatMessage;

type InterpreterTarget = 'de' | 'th';

async function recordingToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Die Aufnahme konnte nicht gelesen werden.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',', 2)[1] : '';
      if (!base64) {
        reject(new Error('Die Aufnahme ist leer.'));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

async function prepareAudioPlayback(
  audioBase64: string,
  previousUri: string | null,
): Promise<string> {
  if (Platform.OS === 'web') {
    return `data:audio/mpeg;base64,${audioBase64}`;
  }

  if (previousUri) {
    await FileSystem.deleteAsync(previousUri, { idempotent: true });
  }
  if (!FileSystem.cacheDirectory) {
    throw new Error('Kein Audio-Cache verfügbar.');
  }

  const uri = `${FileSystem.cacheDirectory}sandra-dolmetscher-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(uri, audioBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

function GlowingLine({ width, height, rotate, top, left }: { width: any, height: number, rotate: string, top: any, left: any }) {
  return (
    <View style={{ position: 'absolute', top, left, width, height, transform: [{ rotate }], justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
      <View style={{ position: 'absolute', width: '100%', height: height + 24, backgroundColor: '#d4af37', opacity: 0.15, borderRadius: height }} />
      <View style={{ position: 'absolute', width: '100%', height: height + 12, backgroundColor: '#d4af37', opacity: 0.25, borderRadius: height }} />
      <View style={{ position: 'absolute', width: '100%', height: height + 4, backgroundColor: '#e6c762', opacity: 0.6, borderRadius: height }} />
      <View style={{ width: '100%', height: height, backgroundColor: '#fff8d6', borderRadius: height }} />
    </View>
  );
}

async function openSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('unsafe');
    const supported = await Linking.canOpenURL(url.toString());
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url.toString());
  } catch {
    Alert.alert(
      'Link nicht verfügbar',
      'Diese sichere Internetadresse konnte nicht geöffnet werden.',
    );
  }
}

function googleMapsUrl(map: NonNullable<Message['maps']>[number]): string | null {
  const query = map.query?.trim() || map.title?.trim();
  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  try {
    const supplied = new URL(map.url ?? '');
    const isGoogleMaps =
      supplied.protocol === 'https:' &&
      (supplied.hostname === 'www.google.com' ||
        supplied.hostname === 'maps.google.com') &&
      supplied.pathname.startsWith('/maps/');
    return isGoogleMaps ? supplied.toString() : null;
  } catch {
    return null;
  }
}

function interpreterFailureMessage(reason?: string): string {
  switch (reason) {
    case 'speech':
      return 'Sandra konnte die Aufnahme nicht verstehen. Bitte sprich noch einmal kurz und deutlich.';
    case 'translation':
      return 'Sandra konnte die Übersetzung nicht erstellen. Bitte versuche es erneut.';
    case 'tts':
      return 'Sandra konnte die Übersetzung nicht vorsprechen. Bitte versuche es erneut.';
    default:
      return 'Sandra: Die Übersetzung konnte nicht abgeschlossen werden.';
  }
}

function MessageBubble({ item }: { item: Message }) {
  return (
    <View style={item.role === 'user' ? styles.userMessage : styles.sandraMessage}>
      <LinkedMessageText item={item} />
      {item.maps?.map((map, index) => (
        <Pressable
          key={`${map.url ?? map.query ?? 'map'}-${index}`}
          style={styles.mapLink}
          onPress={() => {
            const url = googleMapsUrl(map);
            if (url) {
              void openSafeHttpsUrl(url);
              return;
            }
            Alert.alert(
              'Karte nicht verfügbar',
              'Für diesen Eintrag liegt keine sichere Kartenadresse vor.',
            );
          }}
        >
          <Text style={styles.mapLinkText}>
            {map.title ? `${map.title} – ` : ''}In Google Maps öffnen
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function LinkedMessageText({ item }: { item: Message }) {
  const style = item.role === 'user' ? styles.userText : styles.sandraText;
  const parts: Array<{ text: string; url?: string }> = [];
  const urlPattern = /https:\/\/[^\s<>"']+/gu;
  let cursor = 0;
  for (const match of item.text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      parts.push({ text: item.text.slice(cursor, matchIndex) });
    }
    const cleanUrl = rawUrl.replace(/[),.;!?]+$/gu, '');
    if (cleanUrl) parts.push({ text: cleanUrl, url: cleanUrl });
    if (cleanUrl.length < rawUrl.length) {
      parts.push({ text: rawUrl.slice(cleanUrl.length) });
    }
    cursor = matchIndex + rawUrl.length;
  }
  if (cursor < item.text.length) {
    parts.push({ text: item.text.slice(cursor) });
  }

  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.url ? (
          <Text
            key={`${part.url}-${index}`}
            style={styles.inlineLink}
            onPress={() => {
              if (part.url) void openSafeHttpsUrl(part.url);
            }}
            accessibilityRole="link"
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

export default function SandraChatScreen() {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [interpreterTarget, setInterpreterTarget] =
    useState<InterpreterTarget | null>(null);
  const [interpreterBusy, setInterpreterBusy] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const lastAudioUriRef = useRef<string | null>(null);
  const sendRequestRef = useRef(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null);

  useEffect(() => {
    let active = true;

    void loadChatHistory()
      .then((history) => {
        if (active) setMessages(history);
      })
      .finally(() => {
        if (active) setChatLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!chatLoaded) return;
    void saveChatHistory(messages).catch(() => {
      setNotice('Der Chatverlauf konnte nicht auf dem Gerät gespeichert werden.');
    });
  }, [chatLoaded, messages]);

  const footerPadding = useMemo(
    () =>
      Math.max(
        insets.bottom,
        Platform.OS === 'web' ? (viewportHeight <= 480 ? 8 : 34) : 8,
      ),
    [insets.bottom, viewportHeight],
  );
  const topPadding = useMemo(
    () =>
      Math.max(
        insets.top,
        Platform.OS === 'web' ? (viewportHeight <= 480 ? 8 : 67) : 8,
      ),
    [insets.top, viewportHeight],
  );
  const isWideScreen = viewportWidth >= 700;
  const isCompactHeight = viewportHeight <= 600;
  const horizontalPadding = viewportWidth >= 1_000 ? 24 : viewportWidth >= 700 ? 16 : 8;

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending || !chatLoaded) return;
    const requestId = sendRequestRef.current + 1;
    sendRequestRef.current = requestId;
    Keyboard.dismiss();
    setDraft('');
    setNotice('');
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text },
    ]);
    setIsSending(true);
    try {
      const response = await sendSandraMessage(text);
      if (sendRequestRef.current !== requestId) return;
      setMessages((current) => [
        ...current,
        {
          id: `sandra-${Date.now()}`,
          role: 'sandra',
          text: response.reply || 'Keine Antwort erhalten.',
          maps: response.maps,
        },
      ]);
    } catch (error) {
      if (sendRequestRef.current !== requestId) return;
      setNotice(
        getSandraErrorMessage(
          error,
          'Technisches Problem mit der originalen Sandra-API.',
        ),
      );
    } finally {
      if (sendRequestRef.current !== requestId) return;
      setIsSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [chatLoaded, draft, isSending]);

  const handleInterpreter = useCallback(
    async (target: InterpreterTarget) => {
      if (
        interpreterBusy ||
        (interpreterTarget && interpreterTarget !== target)
      ) {
        return;
      }

      if (!recorder.isRecording) {
        try {
          const permission = await requestRecordingPermissionsAsync();
          if (!permission.granted) {
            setNotice('Bitte Mikrofon erlauben oder ein Mikrofon verbinden.');
            if (!permission.canAskAgain && Platform.OS !== 'web') {
              Alert.alert(
                'Mikrofon nicht freigegeben',
                'Bitte erlaube Sandra den Mikrofonzugriff in den Einstellungen.',
                [
                  { text: 'Abbrechen', style: 'cancel' },
                  {
                    text: 'Einstellungen öffnen',
                    onPress: () => {
                      void Linking.openSettings();
                    },
                  },
                ],
              );
            }
            return;
          }

          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
          });
          await recorder.prepareToRecordAsync();
          recorder.record();
          setInterpreterTarget(target);
          setNotice('Jetzt sprechen… Zum Beenden erneut tippen.');
        } catch {
          setNotice('Sandra: Dolmetscher konnte nicht starten.');
        }
        return;
      }

      setInterpreterBusy(true);
      setNotice('Sandra übersetzt…');
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('Keine Aufnahme vorhanden.');

        const audioBase64 = await recordingToBase64(uri);
        const extension = uri.split('.').pop()?.toLowerCase() || 'm4a';
        const mime = extension === 'webm' ? 'audio/webm' : 'audio/mp4';
        const result = await translateSandraRecording({
          audioBase64,
          target,
          mime,
          fileName: `sprache.${extension}`,
        });

        if (!result.ok || !result.heard || !result.translated) {
          throw new Error(interpreterFailureMessage(result.error));
        }

        setMessages((current) => [
          ...current,
          {
            id: `heard-${Date.now()}`,
            role: 'user',
            text: result.heard ?? '',
          },
          {
            id: `translated-${Date.now()}`,
            role: 'sandra',
            text: result.translated ?? '',
          },
        ]);

        if (result.audio) {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          });
          const playbackUri = await prepareAudioPlayback(
            result.audio,
            lastAudioUriRef.current,
          );
          lastAudioUriRef.current =
            Platform.OS === 'web' ? null : playbackUri;
          player.replace(playbackUri);
          player.play();
        }
        setNotice('Übersetzung abgeschlossen.');
      } catch (error) {
        setNotice(
          getSandraErrorMessage(
            error,
            'Sandra: Die Übersetzung konnte nicht abgeschlossen werden.',
          ),
        );
      } finally {
        setInterpreterBusy(false);
        setInterpreterTarget(null);
      }
    },
    [interpreterBusy, interpreterTarget, player, recorder],
  );

  return (
    <View style={styles.appBackground}>
      <View
        style={[
          styles.outerContent,
          {
            paddingTop: topPadding,
            paddingBottom: footerPadding,
            paddingHorizontal: horizontalPadding,
          },
        ]}
      >
        <View
          style={[
            styles.responsiveShell,
            isWideScreen ? styles.responsiveShellWide : null,
          ]}
        >
          <View style={styles.responsiveShellInner}>
            <LinearGradient
              colors={['#050505', '#111111', '#050505']}
              style={StyleSheet.absoluteFill}
            />
            <GlowingLine top="12%" left="-15%" rotate="-22deg" width="130%" height={3} />
            
            <View style={[styles.brandArea, isCompactHeight ? styles.brandAreaCompact : null]}>
              <Text style={styles.brand} maxFontSizeMultiplier={1.5}>
                Hollidayfriend
              </Text>
              <Text style={styles.brandSub} maxFontSizeMultiplier={1.5}>
                Designed from Ralf Pleines Consulting ∞
              </Text>
            </View>

            <View style={[styles.chatInner, isCompactHeight ? styles.chatInnerCompact : null]}>
              <Text style={styles.introTitle} maxFontSizeMultiplier={1.8}>
                Hey, ich bin Sandra
              </Text>
              <Text
                style={[styles.introText, isCompactHeight ? styles.introTextCompact : null]}
                maxFontSizeMultiplier={1.8}
              >
                Für dich da – Freundin und Begleiterin in Pattaya
              </Text>

              <View style={styles.logFrame}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]} />
                <GlowingLine top="20%" left="-25%" rotate="-35deg" width="150%" height={5} />
                <GlowingLine top="65%" left="15%" rotate="28deg" width="130%" height={5} />
                
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => <MessageBubble item={item} />}
                  style={styles.log}
                  contentContainerStyle={styles.logContent}
                  onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  scrollEnabled={messages.length > 0}
                />
                
                {notice ? (
                  <View style={styles.noticeOverlay}>
                    <Text style={styles.noticeText}>{notice}</Text>
                  </View>
                ) : null}
              </View>

              {isSending ? (
                <View style={styles.typing}>
                  <ActivityIndicator size="small" color="#8b1c1c" />
                  <Text style={styles.typingText}>Sandra tippt...</Text>
                </View>
              ) : null}

              <KeyboardAvoidingView
                behavior="padding"
                keyboardVerticalOffset={0}
                style={styles.inputContainer}
              >
                <View style={styles.translateButtons}>
                  <Pressable
                    testID="interpreter-german"
                    style={styles.translateButtonContainer}
                    onPress={() => {
                      void handleInterpreter('th');
                    }}
                    disabled={interpreterBusy || interpreterTarget === 'de'}
                    accessibilityLabel="Deutsch nach Thai dolmetschen"
                  >
                    <LinearGradient colors={['#ffffff', '#eeeeee', '#e0e0e0']} style={styles.translateButtonGradient}>
                      <Text style={styles.translateText}>
                        {interpreterTarget === 'th' ? 'Stop' : 'Deutsch'}
                      </Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable
                    testID="interpreter-thai"
                    style={styles.translateButtonContainer}
                    onPress={() => {
                      void handleInterpreter('de');
                    }}
                    disabled={interpreterBusy || interpreterTarget === 'th'}
                    accessibilityLabel="Thai nach Deutsch dolmetschen"
                  >
                    <LinearGradient colors={['#ffffff', '#eeeeee', '#e0e0e0']} style={styles.translateButtonGradient}>
                      <Text style={styles.translateText}>
                        {interpreterTarget === 'de' ? 'Stop' : 'Thailändisch'}
                      </Text>
                    </LinearGradient>
                  </Pressable>
                </View>
                
                <View style={styles.inputWrapper}>
                  <LinearGradient colors={['#ffffff', '#f4f4f4', '#e8e8e8']} style={StyleSheet.absoluteFill} />
                  <TextInput
                    testID="message-input"
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={send}
                    returnKeyType="send"
                    placeholder="Nachricht eingeben"
                    placeholderTextColor="#888888"
                    style={styles.input}
                    editable={!isSending && chatLoaded}
                    accessibilityLabel="Nachricht eingeben"
                    maxFontSizeMultiplier={1.6}
                  />
                </View>
              </KeyboardAvoidingView>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appBackground: {
    flex: 1,
    backgroundColor: '#e6e6e8',
    overflow: 'hidden',
  },
  outerContent: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  responsiveShell: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    borderRadius: 18,
    shadowColor: '#a0a0a8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 24,
    elevation: 20,
    backgroundColor: '#050505',
  },
  responsiveShellWide: {
    maxWidth: 1000,
  },
  responsiveShellInner: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
  },
  brandArea: {
    height: 48,
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  brandAreaCompact: {
    height: 38,
    marginBottom: 4,
  },
  brand: {
    color: '#e6c762',
    fontSize: 20,
    fontStyle: 'italic',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Palatino' : 'serif',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  brandSub: {
    color: '#d4af37',
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Palatino' : 'serif',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  chatInner: {
    flex: 1,
    minHeight: 0,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  chatInnerCompact: {
    padding: 8,
  },
  introTitle: {
    color: '#111111',
    fontSize: 16,
    fontWeight: 'bold',
  },
  introText: {
    color: '#222222',
    fontSize: 14,
    marginTop: 2,
    marginBottom: 8,
  },
  introTextCompact: {
    marginBottom: 4,
  },
  logFrame: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  log: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  logContent: {
    padding: 10,
    paddingTop: 45,
    gap: 6,
  },
  noticeOverlay: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: '#e6ede6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    zIndex: 10,
    borderWidth: 1,
    borderColor: '#c3d9c3',
  },
  noticeText: {
    color: '#145c14',
    fontSize: 13,
    fontWeight: 'bold',
  },
  userMessage: {
    padding: 6,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  sandraMessage: {
    padding: 6,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  userText: {
    color: '#0b5ed7',
    fontSize: 15,
    fontWeight: '700',
  },
  sandraText: {
    color: '#1f7a1f',
    fontSize: 15,
    fontWeight: '700',
  },
  mapLink: {
    marginTop: 8,
    padding: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4af37',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  mapLinkText: {
    color: '#8a6d1b',
    fontSize: 12,
    fontWeight: '700',
  },
  inlineLink: {
    color: '#0b57d0',
    textDecorationLine: 'underline',
  },
  typing: {
    minHeight: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  typingText: {
    color: '#8b1c1c',
    fontSize: 13,
    fontStyle: 'italic',
  },
  inputContainer: {
    width: '100%',
  },
  translateButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  translateButtonContainer: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: '#cca84b',
    borderRadius: 4,
    overflow: 'hidden',
  },
  translateButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  translateText: {
    color: '#333333',
    fontSize: 15,
    fontWeight: '500',
  },
  inputWrapper: {
    width: '100%',
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: '#cca84b',
    borderRadius: 4,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#222222',
    backgroundColor: 'transparent',
  },
});
