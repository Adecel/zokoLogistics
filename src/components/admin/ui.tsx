import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { TONES, type Tone } from '../../lib/admin/labels';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// Computer (sidebar, tables) vs phone (menu, stacked cards)
export const WIDE_BREAKPOINT = 960;
export function useIsWide() {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

// ---------------------------------------------------------------------------
// Page layout

export function Page({
  title,
  subtitle,
  actions,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const wide = useIsWide();
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.pageContent, { padding: wide ? Spacing.xl : Spacing.md }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      <View style={[styles.pageHeader, !wide && styles.pageHeaderNarrow]}>
        <View style={styles.flex1}>
          <Text style={[styles.pageTitle, !wide && { fontSize: 22 }]}>{title}</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({
  title,
  actions,
  children,
  style,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {(title || actions) && (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
        </View>
      )}
      {children}
    </View>
  );
}

// Responsive grid: as many columns of at least `min` px as fit
export function Grid({ children, min = 260, gap = Spacing.md }: { children: ReactNode; min?: number; gap?: number }) {
  return (
    <View style={[styles.grid, { gap }]}>
      {(Array.isArray(children) ? children : [children]).flat().map((child, i) =>
        child ? (
          <View key={i} style={{ flexGrow: 1, flexBasis: min, minWidth: Math.min(min, 280) }}>
            {child}
          </View>
        ) : null,
      )}
    </View>
  );
}

export function Stat({
  label,
  value,
  icon,
  tone = 'info',
  hint,
  onPress,
}: {
  label: string;
  value: string | number;
  icon: IconName;
  tone?: Tone;
  hint?: string;
  onPress?: () => void;
}) {
  const t = TONES[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.card, styles.stat, pressed && styles.pressed]}>
      <View style={[styles.statIcon, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={20} color={t.fg} />
      </View>
      <View style={styles.flex1}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
        {hint ? <Text style={styles.small}>{hint}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Small pieces

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Notice({ text, tone = 'info' }: { text: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      <Text style={[styles.noticeText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

export function Empty({ icon = 'file-tray-outline', text }: { icon?: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={32} color={Colors.textMuted} />
      <Text style={[styles.muted, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

export function InfoRow({ label, value, children }: { label: string; value?: string | null; children?: ReactNode }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {children ?? (
        <Text style={styles.infoValue} selectable>
          {value || '—'}
        </Text>
      )}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{letters || '?'}</Text>
    </View>
  );
}

// Clickable row used for lists (works as a table row on computer, a card on phone)
export function ListRow({
  onPress,
  children,
  style,
}: {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.listRow,
        hovered && { backgroundColor: '#F7FAFD' },
        pressed && styles.pressed,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Buttons and inputs

type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  small,
  loading,
  disabled,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  small?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const v = BUTTONS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && styles.pressed,
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 15 : 17} color={v.fg} /> : null}
          <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTONS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: Colors.primary, fg: Colors.white, border: Colors.primary },
  outline: { bg: Colors.white, fg: Colors.primary, border: Colors.border },
  danger: { bg: '#FDECEC', fg: Colors.danger, border: '#F8C9CB' },
  ghost: { bg: 'transparent', fg: Colors.textMuted, border: 'transparent' },
  success: { bg: Colors.success, fg: Colors.white, border: Colors.success },
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  error,
  secure,
  hint,
  autoCapitalize,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  error?: string;
  secure?: boolean;
  hint?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { borderColor: error ? Colors.danger : focused ? Colors.primary : Colors.border },
          !editable && { backgroundColor: '#F3F6FA', color: Colors.textMuted },
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.small}>{hint}</Text> : null}
    </View>
  );
}

export function SearchBox({ value, onChangeText, placeholder = 'Rechercher…' }: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={Colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Chips to pick one value (status filters, enums)
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, selected && { color: Colors.white }]}>
                {o.label}
                {o.count !== undefined ? ` (${o.count})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex1}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.small}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.primary, false: Colors.border }}
        thumbColor={Colors.white}
      />
    </View>
  );
}

// Two fields side by side on computer, stacked on phone
export function FieldRow({ children }: { children: ReactNode }) {
  const wide = useIsWide();
  if (!wide) return <View style={styles.fieldRowNarrow}>{children}</View>;
  // Side by side: each field takes an equal share of the width
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={styles.fieldRowWide}>
      {items.map((child, i) => (
        <View key={i} style={styles.fieldRowItem}>
          {child}
        </View>
      ))}
    </View>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  return message ? <Notice text={message} tone="danger" /> : null;
}

// ---------------------------------------------------------------------------
// Sheet: a form in a dialog (centered on computer, full screen on phone)

export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const wide = useIsWide();
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, !wide && { justifyContent: 'flex-end', padding: 0 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, wide ? styles.sheetWide : styles.sheetNarrow]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Fermer">
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog (Alert.alert does not work on the web)

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  // Ask for a text (e.g. reason for refusing); resolves with the text
  input?: { label: string; placeholder?: string; required?: boolean };
};

type ConfirmFn = (options: ConfirmOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Resolves with '' (or the typed text) when confirmed, null when cancelled
export function useConfirm() {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setText('');
    setOptions(o);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function close(value: string | null) {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }

  const missing = !!options?.input?.required && !text.trim();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal visible={!!options} transparent animationType="fade" onRequestClose={() => close(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, styles.dialog]}>
            <Text style={styles.cardTitle}>{options?.title}</Text>
            {options?.message ? <Text style={styles.body}>{options.message}</Text> : null}
            {options?.input ? (
              <TextField
                label={options.input.label}
                placeholder={options.input.placeholder}
                value={text}
                onChangeText={setText}
                multiline
              />
            ) : null}
            <View style={styles.dialogActions}>
              <Button title="Annuler" variant="ghost" onPress={() => close(null)} />
              <Button
                title={options?.confirmLabel ?? 'Confirmer'}
                variant={options?.danger ? 'danger' : 'primary'}
                disabled={missing}
                onPress={() => close(text.trim())}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

// ---------------------------------------------------------------------------

export const ui = StyleSheet.create({
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  small: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  body: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.text, lineHeight: 21 },
  strong: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.text },
  title: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  flex1: { flex: 1, minWidth: 0 },
  gap: { gap: Spacing.md },
  gapSm: { gap: Spacing.sm },
  link: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary },
});

const styles = StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  muted: ui.muted,
  small: ui.small,
  body: ui.body,

  page: { flex: 1, backgroundColor: Colors.background },
  pageContent: { gap: Spacing.md, width: '100%', maxWidth: 1280, alignSelf: 'center', paddingBottom: 64 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm },
  pageHeaderNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  pageTitle: { fontFamily: Fonts.bold, fontSize: 26, color: Colors.navy },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center' },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm + 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, flexWrap: 'wrap' },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.navy },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  stat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  statLabel: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.textMuted },
  statValue: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy },

  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill },
  badgeText: { fontFamily: Fonts.semibold, fontSize: 12 },
  notice: { padding: Spacing.sm + 4, borderRadius: Radius.md },
  noticeText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },

  infoRow: { gap: 2, paddingVertical: 2 },
  infoLabel: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  infoValue: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },

  avatar: { borderRadius: Radius.pill, backgroundColor: '#E3F2FC', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.semibold, color: Colors.primary },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    borderRadius: Radius.sm,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  buttonSmall: { height: 34, paddingHorizontal: Spacing.sm + 4 },
  buttonText: { fontFamily: Fonts.semibold, fontSize: 14 },

  field: { gap: 6, alignSelf: 'stretch' },
  fieldLabel: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.text },
  fieldError: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.danger },
  input: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: Platform.OS === 'web' ? 10 : 8,
    fontFamily: Fonts.regular,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  fieldRowWide: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  fieldRowItem: { flex: 1, minWidth: 0 },
  fieldRowNarrow: { gap: Spacing.md },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.sm + 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    flexGrow: 1,
    minWidth: 200,
  },
  searchInput: { flex: 1, minWidth: 0, fontFamily: Fonts.regular, fontSize: 16, color: Colors.text, height: '100%' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.text },

  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 4 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 37, 69, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  sheet: { backgroundColor: Colors.white, overflow: 'hidden' },
  sheetWide: { width: '100%', maxWidth: 640, maxHeight: '90%', borderRadius: Radius.xl },
  sheetNarrow: { width: '100%', maxHeight: '94%', borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetBody: { padding: Spacing.md, gap: Spacing.md },
  sheetFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  dialog: { width: '100%', maxWidth: 440, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});
