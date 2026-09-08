import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
type AppTab = 'chat' | 'translator' | 'menu';
type InterpreterResult = {
  heard: string;
  translated: string;
  target: InterpreterTarget;
};

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

function LinkedMessageText({ item }: { item: Message }) {
  const style = item.role === 'user' ? styles.userText : styles.sandraText;
  const parts: Array<{ text: string; url?: string }> = [];
  const urlPattern = /https:\/\/[^\s<>"']+/gu;
  let cursor = 0;

  for (const match of item.text.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const matchIndex = match.index;
    if (matchIndex > cursor) parts.push({ text: item.text.slice(cursor, matchIndex) });
    const cleanUrl = rawUrl.replace(/[),.;!?]+$/gu, '');
    if (cleanUrl) parts.push({ text: cleanUrl, url: cleanUrl });
    if (cleanUrl.length < rawUrl.length) parts.push({ text: rawUrl.slice(cleanUrl.length) });
    cursor = matchIndex + rawUrl.length;
  }

  if (cursor < item.text.length) parts.push({ text: item.text.slice(cursor) });

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

function MessageBubble({ item }: { item: Message }) {
  const isUser = item.role === 'user';
  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : null]}>
      {!isUser ? (
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.messageAvatar}
        />
      ) : null}
      <View style={[styles.messageBubble, isUser ? styles.userMessage : styles.sandraMessage]}>
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
              Alert.alert('Karte nicht verfügbar', 'Für diesen Eintrag liegt keine sichere Kartenadresse vor.');
            }}
          >
            <Text style={styles.mapLinkText}>
              📍 {map.title ? `${map.title} – ` : ''}Auf der Karte zeigen
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SandraHeader() {
  return (
    <LinearGradient
      colors={['#143f76', '#294f90', '#d87983', '#f39b6c']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <View style={styles.headerLeft}>
        <View style={styles.brandLine}>
          <Text style={styles.palm}>🌴</Text>
          <View>
            <Text style={styles.brandName}>Sandra</Text>
            <Text style={styles.brandSubtitle}>Dein Pattaya Guide</Text>
          </View>
        </View>
        <Text style={styles.handwritten}>Deine Fragen.{`\n`}Meine Hilfe.{`\n`}Pattaya. Ganz einfach. ♡</Text>
      </View>

      <View style={styles.headerRight}>
        <View style={styles.languagePill}>
          <Text style={styles.languagePillText}>🇩🇪 Deutsch⌄</Text>
        </View>
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.headerAvatar}
        />
        <Text style={styles.pattayaWord}>PATTAYA</Text>
      </View>
    </LinearGradient>
  );
}

function BottomNavigation({ active, onChange }: { active: AppTab; onChange: (tab: AppTab) => void }) {
  const items: Array<{ key: AppTab; icon: string; label: string }> = [
    { key: 'chat', icon: '💬', label: 'Chat' },
    { key: 'translator', icon: '文', label: 'Übersetzer' },
    { key: 'menu', icon: '☰', label: 'Menü' },
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const selected = active === item.key;
        return (
          <Pressable
            key={item.key}
            style={styles.navItem}
            onPress={() => onChange(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Text style={[styles.navIcon, selected ? styles.navActive : null]}>{item.icon}</Text>
            <Text style={[styles.navLabel, selected ? styles.navActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MenuRow({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        {subtitle ? <Text style={styles.menuSubtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={styles.menuChevron}>›</Text>
    </Pressable>
  );
}

export default function SandraChatScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [interpreterTarget, setInterpreterTarget] = useState<InterpreterTarget | null>(null);
  const [interpreterBusy, setInterpreterBusy] = useState(false);
  const [interpreterResult, setInterpreterResult] = useState<InterpreterResult | null>(null);
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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending || !chatLoaded) return;
    const requestId = sendRequestRef.current + 1;
    sendRequestRef.current = requestId;
    Keyboard.dismiss();
    setDraft('');
    setNotice('');
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text }]);
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
      setNotice(getSandraErrorMessage(error, 'Technisches Problem mit der originalen Sandra-API.'));
    } finally {
      if (sendRequestRef.current !== requestId) return;
      setIsSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [chatLoaded, draft, isSending]);

  const handleInterpreter = useCallback(
    async (target: InterpreterTarget) => {
      if (interpreterBusy || (interpreterTarget && interpreterTarget !== target)) return;

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
                  { text: 'Einstellungen öffnen', onPress: () => void Linking.openSettings() },
                ],
              );
            }
            return;
          }

          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await recorder.prepareToRecordAsync();
          recorder.record();
          setInterpreterResult(null);
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

        setInterpreterResult({
          heard: result.heard,
          translated: result.translated,
          target,
        });

        if (result.audio) {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
          const playbackUri = await prepareAudioPlayback(result.audio, lastAudioUriRef.current);
          lastAudioUriRef.current = Platform.OS === 'web' ? null : playbackUri;
          player.replace(playbackUri);
          player.play();
        }
        setNotice('Übersetzung abgeschlossen.');
      } catch (error) {
        setNotice(
          getSandraErrorMessage(error, 'Sandra: Die Übersetzung konnte nicht abgeschlossen werden.'),
        );
      } finally {
        setInterpreterBusy(false);
        setInterpreterTarget(null);
      }
    },
    [interpreterBusy, interpreterTarget, player, recorder],
  );

  const renderChat = () => (
    <View style={styles.pageBody}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble item={item} />}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListHeaderComponent={
          messages.length === 0 ? (
            <View style={styles.welcomeRow}>
              <Image source={require('../../assets/images/icon.png')} style={styles.welcomeAvatar} />
              <View style={styles.welcomeBubble}>
                <Text style={styles.welcomeTitle}>Hallo! 👋</Text>
                <Text style={styles.welcomeText}>Ich bin Sandra, dein persönlicher Pattaya Guide.</Text>
                <Text style={styles.welcomeText}>Wie kann ich dir heute helfen?</Text>
              </View>
            </View>
          ) : null
        }
      />

      {isSending ? (
        <View style={styles.typing}>
          <ActivityIndicator size="small" color="#0b86ff" />
          <Text style={styles.typingText}>Sandra tippt...</Text>
        </View>
      ) : null}

      {notice && activeTab === 'chat' ? <Text style={styles.noticeText}>{notice}</Text> : null}

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        <View style={styles.chatInputRow}>
          <View style={styles.roundAction}>
            <Text style={styles.roundActionText}>🎙</Text>
          </View>
          <View style={styles.inputWrapper}>
            <TextInput
              testID="message-input"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={send}
              returnKeyType="send"
              placeholder="Schreib mir deine Frage ..."
              placeholderTextColor="#8b9ab1"
              style={styles.input}
              editable={!isSending && chatLoaded}
              accessibilityLabel="Nachricht eingeben"
              maxFontSizeMultiplier={1.4}
            />
          </View>
          <Pressable style={styles.roundAction} onPress={send} disabled={isSending || !chatLoaded}>
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );

  const renderTranslator = () => {
    const germanActive = interpreterTarget === 'th';
    const thaiActive = interpreterTarget === 'de';
    return (
      <View style={styles.pageBody}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionIcon}>文</Text>
          <Text style={styles.sectionTitle}>Übersetzer</Text>
        </View>
        <Text style={styles.sectionSubtitle}>Einfach sprechen. Schnell übersetzen.</Text>

        <View style={styles.interpreterButtons}>
          <Pressable
            testID="interpreter-german"
            style={[styles.interpreterButton, germanActive ? styles.interpreterButtonActive : null]}
            onPress={() => void handleInterpreter('th')}
            disabled={interpreterBusy || thaiActive}
            accessibilityLabel="Deutsch nach Thai dolmetschen"
          >
            <Text style={styles.interpreterMic}>🎙</Text>
            <Text style={styles.interpreterButtonText}>{germanActive ? 'Stop' : 'Deutsch'}</Text>
          </Pressable>
          <Pressable
            testID="interpreter-thai"
            style={[styles.interpreterButton, thaiActive ? styles.interpreterButtonActive : null]}
            onPress={() => void handleInterpreter('de')}
            disabled={interpreterBusy || germanActive}
            accessibilityLabel="Thai nach Deutsch dolmetschen"
          >
            <Text style={styles.interpreterMic}>🎙</Text>
            <Text style={styles.interpreterButtonText}>{thaiActive ? 'Stop' : 'Thailändisch'}</Text>
          </Pressable>
        </View>

        {notice ? <Text style={styles.translatorNotice}>{notice}</Text> : null}

        {interpreterBusy ? (
          <View style={styles.translatorBusy}>
            <ActivityIndicator size="small" color="#0b86ff" />
            <Text style={styles.translatorBusyText}>Sandra übersetzt…</Text>
          </View>
        ) : null}

        {interpreterResult ? (
          <View style={styles.translationStack}>
            <View style={styles.translationField}>
              <Text style={styles.translationText}>{interpreterResult.heard}</Text>
            </View>
            <Text style={styles.swapMark}>↕</Text>
            <View style={styles.translationField}>
              <Text style={[styles.translationText, interpreterResult.target === 'th' ? styles.thaiText : null]}>
                {interpreterResult.translated}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.translatorEmpty}>
            <Text style={styles.translatorEmptyText}>
              Tippe auf Deutsch oder Thailändisch und sprich. Die Übersetzung wird danach automatisch vorgelesen.
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderMenu = () => (
    <ScrollView style={styles.pageBody} contentContainerStyle={styles.menuContent}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionIcon}>☰</Text>
        <Text style={styles.sectionTitle}>Menü</Text>
      </View>
      <Text style={styles.sectionSubtitle}>Einstellungen und rechtliche Informationen</Text>

      <View style={styles.menuList}>
        <MenuRow
          icon="⚙"
          title="Einstellungen"
          onPress={() => Alert.alert('Einstellungen', 'Die Einstellungen werden hier eingebunden.')}
        />
        <MenuRow
          icon="▣"
          title="Rechtliche Informationen"
          onPress={() => Alert.alert('Rechtliche Informationen', 'Impressum, Datenschutz und Nutzungsbedingungen werden hier eingebunden.')}
        />
        <MenuRow
          icon="♛"
          title="Abos & Bezahlung"
          onPress={() => Alert.alert('Abos & Bezahlung', 'Tarife und Bezahlfunktionen werden später hier eingebunden.')}
        />
        <MenuRow
          icon="ⓘ"
          title="Über Sandra"
          onPress={() => Alert.alert('Über Sandra', 'Sandra – dein Pattaya Guide.')}
        />
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.appBackground, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.shell}>
        <SandraHeader />
        <View style={styles.contentCard}>
          {activeTab === 'chat' ? renderChat() : null}
          {activeTab === 'translator' ? renderTranslator() : null}
          {activeTab === 'menu' ? renderMenu() : null}
        </View>
        <BottomNavigation active={activeTab} onChange={(tab) => {
          setNotice('');
          setActiveTab(tab);
        }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appBackground: {
    flex: 1,
    backgroundColor: '#dfe7f0',
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
  },
  header: {
    height: 132,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  headerLeft: {
    flex: 1,
    justifyContent: 'space-between',
  },
  headerRight: {
    width: 150,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  brandLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  palm: {
    fontSize: 28,
    marginRight: 6,
  },
  brandName: {
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 25,
    fontWeight: '800',
  },
  brandSubtitle: {
    color: '#ffffff',
    fontSize: 10,
    opacity: 0.95,
  },
  handwritten: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 16,
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Snell Roundhand' : 'cursive',
  },
  languagePill: {
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(4,31,65,0.76)',
  },
  languagePillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  headerAvatar: {
    position: 'absolute',
    right: 48,
    bottom: -16,
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.88)',
  },
  pattayaWord: {
    color: '#ff7d35',
    fontSize: 14,
    letterSpacing: 2,
    fontWeight: '900',
    marginBottom: 4,
  },
  contentCard: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  pageBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  chatContent: {
    paddingBottom: 10,
    gap: 8,
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  welcomeAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
  },
  welcomeBubble: {
    flex: 1,
    backgroundColor: '#edf3f8',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  welcomeTitle: {
    color: '#0b2457',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  welcomeText: {
    color: '#10295e',
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 4,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 7,
  },
  messageBubble: {
    maxWidth: '84%',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  userMessage: {
    backgroundColor: '#dceeff',
  },
  sandraMessage: {
    backgroundColor: '#edf3f8',
  },
  userText: {
    color: '#10295e',
    fontSize: 14,
    lineHeight: 19,
  },
  sandraText: {
    color: '#10295e',
    fontSize: 14,
    lineHeight: 19,
  },
  inlineLink: {
    color: '#0b74e5',
    textDecorationLine: 'underline',
  },
  mapLink: {
    marginTop: 7,
    borderRadius: 8,
    backgroundColor: '#0b86ff',
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  mapLinkText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  typing: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 3,
  },
  typingText: {
    color: '#68809e',
    fontSize: 12,
  },
  noticeText: {
    color: '#44627e',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 4,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  roundAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0b86ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundActionText: {
    color: '#ffffff',
    fontSize: 18,
  },
  sendIcon: {
    color: '#ffffff',
    fontSize: 20,
  },
  inputWrapper: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#d9e5f1',
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  input: {
    paddingHorizontal: 14,
    fontSize: 13,
    color: '#173566',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sectionIcon: {
    color: '#0b4fa3',
    fontSize: 20,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#10295e',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#6b82a0',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 13,
  },
  interpreterButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  interpreterButton: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d6e3f0',
    backgroundColor: '#eef5fb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  interpreterButtonActive: {
    borderColor: '#0b86ff',
    backgroundColor: '#dceeff',
  },
  interpreterMic: {
    fontSize: 14,
  },
  interpreterButtonText: {
    color: '#133166',
    fontSize: 12,
    fontWeight: '700',
  },
  translatorNotice: {
    color: '#5f7797',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 8,
  },
  translatorBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  translatorBusyText: {
    color: '#5f7797',
    fontSize: 11,
  },
  translationStack: {
    gap: 7,
  },
  translationField: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#edf3f8',
    paddingHorizontal: 11,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  translationText: {
    color: '#173566',
    fontSize: 13,
    lineHeight: 18,
  },
  thaiText: {
    fontSize: 14,
    fontWeight: '600',
  },
  swapMark: {
    color: '#0b86ff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
  },
  translatorEmpty: {
    marginTop: 14,
    padding: 12,
    borderRadius: 9,
    backgroundColor: '#f5f8fb',
  },
  translatorEmptyText: {
    color: '#6a819d',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  menuContent: {
    paddingBottom: 18,
  },
  menuList: {
    gap: 9,
  },
  menuRow: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#d9e5f1',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  menuIcon: {
    width: 28,
    color: '#0b86ff',
    fontSize: 18,
    textAlign: 'center',
    marginRight: 8,
  },
  menuCopy: {
    flex: 1,
  },
  menuTitle: {
    color: '#173566',
    fontSize: 13,
    fontWeight: '700',
  },
  menuSubtitle: {
    color: '#7790ad',
    fontSize: 10,
    marginTop: 2,
  },
  menuChevron: {
    color: '#6d89aa',
    fontSize: 23,
    marginLeft: 8,
  },
  bottomNav: {
    height: 64,
    backgroundColor: '#03233d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 18,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  navIcon: {
    color: '#ffffff',
    fontSize: 20,
  },
  navLabel: {
    color: '#ffffff',
    fontSize: 10,
  },
  navActive: {
    color: '#0b86ff',
  },
});
