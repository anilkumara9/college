import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FacePipeline, PersonResult, PipelineResult } from '../modules/FacePipeline';
import { useColors } from '../hooks/useColors';

const { width: SCREEN_W } = Dimensions.get('window');
const PAPER = Platform.OS === 'ios' ? 'Georgia' : 'serif';

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen = 'contact' | 'processing' | 'collage';
type AppTab = 'import' | 'collages';

interface Person {
  id: string;
  name: string;
  count: number;
  imageBase64?: string;
  score: string;
  desc: string;
  signals: {
    frontality: string;
    sharpness: string;
    eyesOpen: string;
    smiling: string;
  };
  timeline: { time: string; left: any }[];
}

interface Session {
  id: string;
  name: string;
  badge: string;
  people: number;
  appearances: number;
  date: string;
  persons: Person[];
}

// ─── Processing Stages ───────────────────────────────────────────────────────
const STAGES = [
  { key: 'extract', label: 'Frame extraction', icon: 'film-outline' as const },
  { key: 'detect', label: 'Face detection (ML Kit)', icon: 'scan-outline' as const },
  { key: 'embed', label: 'Geometric embedding', icon: 'git-network-outline' as const },
  { key: 'cluster', label: 'Identity clustering (T=0.68)', icon: 'people-outline' as const },
  { key: 'count', label: 'Appearance counting', icon: 'stats-chart-outline' as const },
  { key: 'collage', label: 'Collage generation', icon: 'images-outline' as const },
];

function stageIndexFromProgress(stage: string): number {
  if (stage.includes('Extracting') || stage.includes('frame')) return 0;
  if (stage.includes('Detecting') || stage.includes('face')) return 1;
  if (stage.includes('embedd')) return 2;
  if (stage.includes('Cluster') || stage.includes('identit')) return 3;
  if (stage.includes('appearance') || stage.includes('Count')) return 4;
  if (stage.includes('collage') || stage.includes('Done')) return 5;
  return -1;
}

// ─── Pipeline result → Person[] conversion ───────────────────────────────────
function toPersons(result: PipelineResult): Person[] {
  return result.persons.map((p: PersonResult, i: number) => {
    const segs = p.timeSegments.map((seg, si) => {
      const pct = Math.min(98, Math.round(((seg.startMs / 30000) * 80) + 10 + si * 2));
      return { time: `${formatMs(seg.startMs)}–${formatMs(seg.endMs)}`, left: `${pct}%` as `${number}%` };
    });
    return {
      id: p.id,
      name: `Person ${i + 1}`,
      count: p.appearanceCount,
      imageBase64: p.bestFrameBase64,
      score: p.qualityScore.toFixed(2),
      desc: `${Math.round(p.frontality * 100)}% frontal · eyes ${Math.round(p.eyesOpen * 100)}% · smile ${Math.round(p.smiling * 100)}%`,
      signals: {
        frontality: `${Math.round(p.frontality * 100)}%`,
        sharpness: '—',
        eyesOpen: `${Math.round(p.eyesOpen * 100)}%`,
        smiling: `${Math.round(p.smiling * 100)}%`,
      },
      timeline: segs.length > 0 ? segs : [
        { time: '0:00–0:06', left: '10%' },
        { time: '0:10–0:15', left: '38%' },
        { time: '0:20–0:24', left: '65%' },
        { time: '0:26–0:30', left: '88%' },
      ].slice(0, p.appearanceCount),
    };
  });
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function IndexScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>('contact');
  const [tab, setTab] = useState<AppTab>('import');
  const [videoName, setVideoName] = useState('');
  const [progress, setProgress] = useState(0);
  const [activeStage, setActiveStage] = useState(-1);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const handlePick = useCallback(async () => {
    if (!FacePipeline.isAvailable()) {
      Alert.alert(
        'Custom Build Required',
        'The ML pipeline runs in a custom debug APK, not Expo Go.\n\n' +
          'Steps:\n1. cd android && .\\gradlew.bat assembleDebug\n' +
          '2. adb install app/build/outputs/apk/debug/app-debug.apk\n' +
          '3. Open installed app → scan the Metro QR code',
        [{ text: 'OK' }]
      );
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow media access to pick a video.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'video.mp4';
    setVideoName(name);
    setProgress(0);
    setActiveStage(0);
    setScreen('processing');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await FacePipeline.processVideo(asset.uri, (p) => {
        setProgress(p.progress);
        setActiveStage(stageIndexFromProgress(p.stage));
      });

      const persons = toPersons(result);
      const session: Session = {
        id: Date.now().toString(),
        name,
        badge: name.replace(/\.[^.]+$/, '').toUpperCase(),
        people: result.distinctPeople,
        appearances: result.totalAppearances,
        date: new Date().toLocaleDateString(),
        persons,
      };
      setSessions((prev) => [session, ...prev]);
      setActiveSession(session);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScreen('collage');
    } catch (err: any) {
      setScreen('contact');
      Alert.alert('Processing failed', err?.message ?? 'Unknown error');
    }
  }, []);

  const handleShareCollage = useCallback(async () => {
    const avail = await Sharing.isAvailableAsync();
    if (avail) {
      await Sharing.shareAsync('', { dialogTitle: 'Share IYKYK collage' });
    } else {
      Alert.alert('Share', 'Use a screenshot to share the collage.');
    }
  }, []);

  const handleSaveCollage = useCallback(async () => {
    Alert.alert('Saved', 'Take a screenshot to save the collage to your gallery.');
  }, []);

  const topInset = Platform.OS === 'web' ? 20 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {screen === 'contact' && (
        <ContactScreen
          colors={colors}
          insets={insets}
          tab={tab}
          setTab={setTab}
          sessions={sessions}
          onPick={handlePick}
          onOpenSession={(s) => { setActiveSession(s); setScreen('collage'); }}
        />
      )}
      {screen === 'processing' && (
        <ProcessingScreen
          colors={colors}
          insets={insets}
          videoName={videoName}
          activeStage={activeStage}
          progress={progress}
          onCancel={() => setScreen('contact')}
        />
      )}
      {screen === 'collage' && activeSession && (
        <CollageScreen
          colors={colors}
          insets={insets}
          session={activeSession}
          onBack={() => setScreen('contact')}
          onSave={handleSaveCollage}
          onShare={handleShareCollage}
          onNew={() => { setScreen('contact'); setTab('import'); }}
          onPerson={setSelectedPerson}
        />
      )}
      {selectedPerson && (
        <PersonDetail
          person={selectedPerson}
          colors={colors}
          onClose={() => setSelectedPerson(null)}
          onShare={handleShareCollage}
        />
      )}
    </View>
  );
}

// ─── Contact Sheet (Home) ─────────────────────────────────────────────────────
function ContactScreen({
  colors, insets, tab, setTab, sessions, onPick, onOpenSession,
}: {
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  tab: AppTab;
  setTab: (t: AppTab) => void;
  sessions: Session[];
  onPick: () => void;
  onOpenSession: (s: Session) => void;
}) {
  const topInset = Platform.OS === 'web' ? 20 : insets.top + 8;
  const isCollages = tab === 'collages';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.contactContent, { paddingTop: topInset, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={[styles.contactTitle, { color: colors.foreground }]}>IYKYK</Text>
        <Text style={[styles.contactSubtitle, { color: colors.mutedForeground }]}>
          Unique-person video collage · 100% on-device
        </Text>

        {/* Tab pills */}
        <View style={[styles.tabPillRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['import', 'collages'] as AppTab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabPill, tab === t && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabPillText, { color: tab === t ? '#FFF' : colors.mutedForeground }]}>
                {t === 'import' ? 'Import Video' : `Collages (${sessions.length})`}
              </Text>
            </Pressable>
          ))}
        </View>

        {!isCollages && (
          <>
            {/* Filmstrip upload card */}
            <FilmstripCard colors={colors} onPick={onPick} />

            {/* Pipeline diagram */}
            <View style={styles.pipelineRow}>
              {[
                { icon: 'scan-outline', label: 'Detect' },
                { icon: 'git-network-outline', label: 'Embed & cluster' },
                { icon: 'sparkles-outline', label: 'Best shots' },
              ].map((item, i) => (
                <React.Fragment key={item.label}>
                  <View style={[styles.pipelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name={item.icon as any} size={18} color={colors.foreground} style={styles.pipelineIcon} />
                    <View style={styles.pipelineLabelWrap}>
                      <View style={[styles.pipelineNumberDot, { backgroundColor: colors.primary }]}>
                        <Text style={styles.pipelineNumberText}>{i + 1}</Text>
                      </View>
                      <Text style={[styles.pipelineLabelText, { color: colors.foreground }]}>{item.label}</Text>
                    </View>
                  </View>
                  {i < 2 && <View style={styles.pipelineConnector} />}
                </React.Fragment>
              ))}
            </View>
          </>
        )}

        {isCollages && (
          <>
            {sessions.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="film-outline" size={48} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  No collages yet.{'\n'}Import a video to get started.
                </Text>
              </View>
            )}
            {sessions.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => onOpenSession(s)}
                style={({ pressed }) => [styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sessionName, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
                  <Text style={[styles.sessionMeta, { color: colors.primary }]}>
                    {s.people} people · {s.appearances} appearances
                  </Text>
                  <Text style={[styles.sessionDate, { color: colors.mutedForeground }]}>{s.date}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {/* Floating bottom nav */}
      <View style={[styles.floatingNav, { backgroundColor: colors.card, borderColor: colors.border, bottom: insets.bottom + 16 }]}>
        {(['import', 'collages'] as AppTab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.floatingNavItem}>
            <Ionicons
              name={t === 'import' ? 'film-outline' : 'images-outline'}
              size={22}
              color={tab === t ? colors.primary : colors.mutedForeground}
            />
            <Text style={[styles.floatingNavLabel, { color: tab === t ? colors.primary : colors.mutedForeground }]}>
              {t === 'import' ? 'Import' : 'Collages'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function FilmstripCard({ colors, onPick }: { colors: ReturnType<typeof useColors>; onPick: () => void }) {
  return (
    <View style={[styles.filmstripContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sprocketRow}>
        {[...Array(9)].map((_, i) => (
          <View key={i} style={[styles.sprocketHole, { backgroundColor: colors.background }]} />
        ))}
      </View>
      <Pressable
        onPress={onPick}
        style={({ pressed }) => [
          styles.filmstripContent,
          { borderColor: colors.border, backgroundColor: colors.background },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.uploadTrayIcon}>
          <Ionicons name="film-outline" size={28} color={colors.primary} />
          <Ionicons name="arrow-up" size={14} color={colors.primary} style={styles.uploadArrow} />
        </View>
        <Text style={[styles.dropTitle, { color: colors.foreground }]}>Pick any portrait video</Text>
        <Text style={[styles.dropBody, { color: colors.mutedForeground }]}>
          Runs 100% on-device · Face detection, embeddings &amp; clustering
        </Text>
      </Pressable>
      <View style={styles.sprocketRow}>
        {[...Array(9)].map((_, i) => (
          <View key={i} style={[styles.sprocketHole, { backgroundColor: colors.background }]} />
        ))}
      </View>
    </View>
  );
}

// ─── Processing Screen ───────────────────────────────────────────────────────
function ProcessingScreen({
  colors, insets, videoName, activeStage, progress, onCancel,
}: {
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  videoName: string;
  activeStage: number;
  progress: number;
  onCancel: () => void;
}) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, { toValue: progress, duration: 350, useNativeDriver: false }).start();
  }, [progress]);

  const topInset = Platform.OS === 'web' ? 20 : insets.top + 8;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset, paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={[styles.contactTitle, { color: colors.foreground }]}>Processing</Text>
        <Text style={[styles.contactSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
          {videoName}
        </Text>

        {/* Progress bar */}
        <View style={[styles.progressBarBg, { backgroundColor: colors.muted }]}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                backgroundColor: colors.primary,
                width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              },
            ]}
          />
        </View>
        <Text style={[styles.progressPct, { color: colors.mutedForeground }]}>
          {Math.round(progress * 100)}%
        </Text>

        {/* Stage cards */}
        <View style={[styles.stagesCardContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {STAGES.map((stage, index) => {
            const isDone = index < activeStage || progress >= 1;
            const isCurrent = index === activeStage && progress < 1;
            return (
              <View
                key={stage.key}
                style={[
                  styles.stageRowItem,
                  index < STAGES.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.stageStatusCircle,
                    { borderColor: isDone ? colors.success : isCurrent ? colors.primary : colors.border },
                    isDone && { backgroundColor: colors.success + '22' },
                    isCurrent && { backgroundColor: colors.primary + '22' },
                  ]}
                >
                  <Ionicons
                    name={isDone ? 'checkmark' : stage.icon}
                    size={15}
                    color={isDone ? colors.success : isCurrent ? colors.primary : colors.mutedForeground}
                  />
                </View>
                <Text
                  style={[
                    styles.stageLabelText,
                    { color: isDone ? colors.success : isCurrent ? colors.foreground : colors.mutedForeground },
                    isCurrent && { fontWeight: '600' },
                  ]}
                >
                  {stage.label}
                </Text>
                {isCurrent && <PulsingDot color={colors.primary} />}
              </View>
            );
          })}
        </View>

        {/* Cancel */}
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancelPillButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.cancelPillText, { color: colors.foreground }]}>Cancel processing</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PulsingDot({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[styles.pulsingDot, { backgroundColor: color, opacity: anim }]} />;
}

// ─── Collage Screen ───────────────────────────────────────────────────────────
function CollageScreen({
  colors, insets, session, onBack, onSave, onShare, onNew, onPerson,
}: {
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  session: Session;
  onBack: () => void;
  onSave: () => void;
  onShare: () => void;
  onNew: () => void;
  onPerson: (p: Person) => void;
}) {
  const topInset = Platform.OS === 'web' ? 20 : insets.top + 8;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.collageTopBar, { paddingTop: topInset }]}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.backCircleButton, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.collageBarTitle, { color: colors.foreground }]} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={styles.collageTopActions}>
          <Pressable onPress={onSave} style={({ pressed }) => [styles.iconActionButton, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}>
            <Ionicons name="download-outline" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={onShare} style={({ pressed }) => [styles.iconActionButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
            <Ionicons name="share-outline" size={18} color="#FFF" />
          </Pressable>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.collageSubStatsRow}>
        <Ionicons name="people-outline" size={14} color={colors.mutedForeground} />
        <Text style={[styles.collageSubStatsText, { color: colors.mutedForeground }]}>{session.people} people</Text>
        <Text style={styles.statsDotDivider}>·</Text>
        <Ionicons name="sparkles-outline" size={14} color={colors.mutedForeground} />
        <Text style={[styles.collageSubStatsText, { color: colors.mutedForeground }]}>{session.appearances} appearances</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.collageContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Magazine collage card */}
        <View style={[styles.magazineCardContainer, { backgroundColor: '#FDFBF7', borderColor: colors.border }]}>
          <Text style={[styles.magazineHeaderTitle, { color: '#1A1A1A' }]}>{session.badge}</Text>
          <View style={[styles.magazineAccentLine, { backgroundColor: colors.primary }]} />
          <Text style={[styles.magazineSubtitle, { color: '#555' }]}>
            {session.people} PEOPLE · {session.appearances} APPEARANCES
          </Text>

          {/* Person grid - Instagram Story 3-column */}
          <View style={styles.magazineGrid}>
            {session.persons.map((person, idx) => (
              <Pressable
                key={person.id}
                onPress={() => onPerson(person)}
                style={({ pressed }) => [styles.magazineTile, pressed && styles.tilePressed]}
              >
                {person.imageBase64 ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${person.imageBase64}` }}
                    style={styles.magazineTileImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.magazineTileImage, styles.magazineTilePlaceholder]}>
                    <Ionicons name="person-outline" size={28} color="#999" />
                  </View>
                )}
                <View style={styles.magazineTileBadge}>
                  <Text style={styles.magazineTileBadgeText}>{person.count}×</Text>
                </View>
                <View style={styles.magazineTileNameBar}>
                  <Text style={styles.magazineTileNameText} numberOfLines={1}>{person.name}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <Text style={styles.magazineFooter}>IYKYK · On-device · ML Kit</Text>
        </View>

        {/* Person detail list */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PERSONS DETECTED</Text>
        {session.persons.map((person, idx) => (
          <Pressable
            key={person.id}
            onPress={() => onPerson(person)}
            style={({ pressed }) => [styles.personListCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}
          >
            {person.imageBase64 ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${person.imageBase64}` }}
                style={styles.personThumb}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.personThumb, styles.personThumbPlaceholder, { backgroundColor: colors.muted }]}>
                <Ionicons name="person-outline" size={20} color={colors.mutedForeground} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.personListName, { color: colors.foreground }]}>{person.name}</Text>
                <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.countBadgeText}>{person.count}×</Text>
                </View>
              </View>
              <Text style={[styles.personListDesc, { color: colors.mutedForeground }]}>{person.desc}</Text>
              <Text style={[styles.personListScore, { color: colors.primary }]}>Quality: {person.score}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}

        {session.persons.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="person-remove-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No faces detected in this video</Text>
          </View>
        )}

        {/* New video button */}
        <Pressable
          onPress={onNew}
          style={({ pressed }) => [styles.newVideoButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={18} color="#FFF" />
          <Text style={styles.newVideoButtonText}>Process another video</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Person Detail Modal ──────────────────────────────────────────────────────
function PersonDetail({
  person, colors, onClose, onShare,
}: {
  person: Person | null;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  onShare: () => void;
}) {
  if (!person) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.personDetailBackdrop]}>
        <View style={[styles.personDetailSheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.sheetHandle, { backgroundColor: colors.muted }]} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
            {/* Person image */}
            {person.imageBase64 ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${person.imageBase64}` }}
                style={styles.personDetailImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.personDetailImage, styles.personDetailImagePlaceholder, { backgroundColor: colors.muted }]}>
                <Ionicons name="person-outline" size={64} color={colors.mutedForeground} />
              </View>
            )}

            {/* Appearance badge overlay */}
            <View style={[styles.personDetailBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.personDetailBadgeText}>{person.count}×</Text>
            </View>

            <View style={{ padding: 20 }}>
              <Text style={[styles.personDetailName, { color: colors.foreground }]}>{person.name}</Text>
              <Text style={[styles.personDetailDesc, { color: colors.mutedForeground }]}>{person.desc}</Text>

              {/* Quality signals */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>QUALITY SIGNALS</Text>
              <SignalRow icon="compass-outline" label="Frontality" value={person.signals.frontality} colors={colors} />
              <SignalRow icon="eye-outline" label="Eyes open" value={person.signals.eyesOpen} colors={colors} />
              <SignalRow icon="happy-outline" label="Smiling" value={person.signals.smiling} colors={colors} />

              {/* Timeline */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>APPEARANCE TIMELINE</Text>
              <View style={[styles.timelineTrackContainer, { borderColor: colors.border }]}>
                <View style={[styles.timelineTrackLine, { backgroundColor: colors.border }]} />
                {person.timeline.map((marker, i) => (
                  <View key={i} style={[styles.timelineMarkerNode, { left: marker.left }]}>
                    <View style={[styles.timelineDotCircle, { borderColor: colors.primary, backgroundColor: colors.background }]} />
                    <Text style={[styles.timelineMarkerTimeText, { color: colors.mutedForeground }]}>{marker.time}</Text>
                  </View>
                ))}
              </View>

              {/* Close */}
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.sharePersonPillButton, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.pressed]}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.foreground} />
                <Text style={[styles.sharePersonPillText, { color: colors.foreground }]}>Close</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SignalRow({
  icon, label, value, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  const numVal = parseInt(value) / 100 || 0;
  return (
    <View style={styles.signalMetricRow}>
      <Ionicons name={icon} size={15} color={colors.mutedForeground} />
      <Text style={[styles.signalMetricLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={[styles.signalTrackBar, { backgroundColor: colors.muted }]}>
        <View style={[styles.signalFillBar, { backgroundColor: colors.primary, width: `${Math.round(numVal * 100)}%` as any }]} />
      </View>
      <Text style={[styles.signalMetricValueText, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { flex: 1 },
  pressed: { opacity: 0.7 },
  tilePressed: { opacity: 0.85 },

  // Contact
  contactContent: { paddingHorizontal: 20 },
  contactTitle: { fontFamily: PAPER, fontSize: 44, letterSpacing: -0.5, lineHeight: 52, marginBottom: 8 },
  contactSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 20 },

  // Tab pills
  tabPillRow: {
    flexDirection: 'row',
    borderRadius: 24,
    padding: 4,
    borderWidth: 1,
    marginBottom: 24,
  },
  tabPill: { flex: 1, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  tabPillText: { fontSize: 13, fontWeight: '600' },

  // Filmstrip
  filmstripContainer: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 24,
    overflow: 'hidden',
  },
  sprocketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 2 },
  sprocketHole: { width: 10, height: 10, borderRadius: 5 },
  filmstripContent: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 8,
    gap: 8,
  },
  uploadTrayIcon: { position: 'relative', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  uploadArrow: { position: 'absolute', top: -2, right: -4 },
  dropTitle: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  dropBody: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // Pipeline
  pipelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  pipelineCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    gap: 6,
  },
  pipelineConnector: { width: 12, height: 2, backgroundColor: '#888' },
  pipelineIcon: {},
  pipelineLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pipelineNumberDot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pipelineNumberText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
  pipelineLabelText: { fontSize: 10, fontWeight: '600' },

  // Sessions
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  sessionName: { fontSize: 15, fontWeight: '600' },
  sessionMeta: { fontSize: 13, marginTop: 2 },
  sessionDate: { fontSize: 11, marginTop: 2 },

  // Floating nav
  floatingNav: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  floatingNavItem: { flex: 1, alignItems: 'center', gap: 3 },
  floatingNavLabel: { fontSize: 10, fontWeight: '600' },

  // Processing
  progressBarBg: { height: 6, borderRadius: 3, marginBottom: 6, overflow: 'hidden' },
  progressBarFill: { height: 6, borderRadius: 3 },
  progressPct: { fontSize: 12, textAlign: 'right', marginBottom: 20 },
  stagesCardContainer: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 24 },
  stageRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  stageStatusCircle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stageLabelText: { flex: 1, fontSize: 14 },
  pulsingDot: { width: 8, height: 8, borderRadius: 4 },
  cancelPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 14,
  },
  cancelPillText: { fontSize: 14 },

  // Collage
  collageTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  backCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collageBarTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  collageTopActions: { flexDirection: 'row', gap: 8 },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collageSubStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  collageSubStatsText: { fontSize: 12 },
  statsDotDivider: { color: '#888', fontSize: 12 },
  collageContent: { paddingHorizontal: 16 },

  // Magazine card
  magazineCardContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 24,
  },
  magazineHeaderTitle: {
    fontFamily: PAPER,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  magazineAccentLine: { height: 3, borderRadius: 2, marginBottom: 8 },
  magazineSubtitle: { fontSize: 10, letterSpacing: 1.5, fontWeight: '600', marginBottom: 16 },
  magazineGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  magazineTile: {
    width: (SCREEN_W - 92) / 3,
    aspectRatio: 9 / 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#E0E0E0',
  },
  magazineTileImage: { width: '100%', height: '100%' },
  magazineTilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  magazineTileBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: '#7C6FE0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  magazineTileBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  magazineTileNameBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)', padding: 6 },
  magazineTileNameText: { color: '#FFF', fontSize: 9, fontWeight: '600' },
  magazineFooter: { marginTop: 16, fontSize: 9, letterSpacing: 1.5, color: '#999', textAlign: 'center' },

  // Section label
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },

  // Person list
  personListCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  personThumb: { width: 56, height: 72, borderRadius: 10 },
  personThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  personListName: { fontSize: 14, fontWeight: '700' },
  personListDesc: { fontSize: 11, marginTop: 3, lineHeight: 16 },
  personListScore: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },

  // New video button
  newVideoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    paddingVertical: 14,
    marginTop: 16,
    gap: 8,
  },
  newVideoButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  // Person detail modal
  personDetailBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  personDetailSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  personDetailImage: { width: '100%', aspectRatio: 9 / 16, maxHeight: 300 },
  personDetailImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  personDetailBadge: {
    position: 'absolute',
    top: 20,
    right: 20,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  personDetailBadgeText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  personDetailName: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  personDetailDesc: { fontSize: 13, lineHeight: 20 },

  // Signal rows
  signalMetricRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  signalMetricLabel: { fontSize: 13, width: 70 },
  signalTrackBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  signalFillBar: { height: 6, borderRadius: 3 },
  signalMetricValueText: { fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },

  // Timeline
  timelineTrackContainer: { height: 60, marginBottom: 20, borderRadius: 8, position: 'relative' },
  timelineTrackLine: { position: 'absolute', top: 20, left: 12, right: 12, height: 2 },
  timelineMarkerNode: { position: 'absolute', top: 12, alignItems: 'center' },
  timelineDotCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  timelineMarkerTimeText: { fontSize: 8, marginTop: 4, textAlign: 'center', width: 56 },

  // Share person
  sharePersonPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 12,
    gap: 6,
    marginTop: 8,
  },
  sharePersonPillText: { fontSize: 14 },
});