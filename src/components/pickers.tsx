import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dayName, formatShortDate, monthName, toISODate } from '../constants/dates';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

// Horizontal list of days: value / onChange use "2026-11-29"
export function DayPicker({ days, value, onChange }: { days: Date[]; value: string; onChange: (iso: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {days.map((d) => {
        const iso = toISODate(d);
        const selected = iso === value;
        return (
          <Pressable
            key={iso}
            onPress={() => onChange(iso)}
            style={[styles.day, selected && styles.selected]}
            accessibilityLabel={formatShortDate(d)}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.small, selected && styles.onPrimary]}>{dayName(d)}</Text>
            <Text style={[styles.big, selected && styles.onPrimary]}>{d.getDate()}</Text>
            <Text style={[styles.small, selected && styles.onPrimary]}>{monthName(d)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Horizontal list of start times ("08:00", "08:30"...)
export function TimePicker({ slots, value, onChange }: { slots: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {slots.map((t) => {
        const selected = t === value;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            style={[styles.time, selected && styles.selected]}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.timeText, selected && styles.onPrimary]}>{t}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Segmented choice (durations)
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, selected && styles.selected]}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.segmentText, selected && styles.onPrimary]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingVertical: 2 },
  selected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  onPrimary: { color: Colors.white },

  day: {
    width: 58,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  small: { fontFamily: Fonts.regular, fontSize: 11, color: Colors.textMuted },
  big: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.text },

  time: {
    paddingHorizontal: Spacing.md,
    height: 40,
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  timeText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.text },

  segment: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentItem: { flex: 1, height: 42, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 0 },
  segmentText: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
});
