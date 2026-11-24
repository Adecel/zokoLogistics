import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

export type Driver = { driver_id: string; full_name: string; avatar_url: string | null };

export type DriversState = { state: 'loading' } | { state: 'ok'; drivers: Driver[] } | { state: 'error' };

type Props = {
  drivers: DriversState;
  // null = let Zoko choose
  value: string | null;
  onChange: (driverId: string | null) => void;
};

// List of drivers free for the chosen slot, plus "let Zoko choose"
export function DriverPicker({ drivers, value, onChange }: Props) {
  const list = drivers.state === 'ok' ? drivers.drivers : [];
  const chosenGone = value !== null && drivers.state === 'ok' && !list.some((d) => d.driver_id === value);

  return (
    <View style={styles.list}>
      <Option
        selected={value === null}
        onPress={() => onChange(null)}
        avatar={<Initials icon="sparkles-outline" />}
        title="Laisser Zoko choisir"
        subtitle="Un chauffeur disponible vous sera attribué à la confirmation"
      />

      {drivers.state === 'loading' && <Text style={styles.muted}>Recherche des chauffeurs disponibles…</Text>}
      {drivers.state === 'error' && (
        <Text style={styles.muted}>Liste des chauffeurs indisponible (connexion). Vous pouvez laisser Zoko choisir.</Text>
      )}
      {drivers.state === 'ok' && list.length === 0 && (
        <Text style={styles.muted}>Aucun chauffeur libre à ce créneau : Zoko vous en attribuera un.</Text>
      )}

      {list.map((d) => (
        <Option
          key={d.driver_id}
          selected={value === d.driver_id}
          onPress={() => onChange(d.driver_id)}
          avatar={
            d.avatar_url ? (
              <Image source={{ uri: d.avatar_url }} style={styles.avatar} contentFit="cover" transition={150} />
            ) : (
              <Initials name={d.full_name} />
            )
          }
          title={d.full_name}
          subtitle="Disponible à ce créneau"
        />
      ))}

      {chosenGone && (
        <Text style={styles.warning}>
          Le chauffeur choisi n’est pas libre à ce créneau. Choisissez-en un autre ou laissez Zoko choisir.
        </Text>
      )}
    </View>
  );
}

function Option({
  selected,
  onPress,
  avatar,
  title,
  subtitle,
}: {
  selected: boolean;
  onPress: () => void;
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {avatar}
      <View style={styles.flex1}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? Colors.primary : Colors.border}
      />
    </Pressable>
  );
}

function Initials({ name, icon }: { name?: string; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={styles.avatar}>
      {icon ? (
        <Ionicons name={icon} size={20} color={Colors.primary} />
      ) : (
        <Text style={styles.initials}>{letters || '?'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  flex1: { flex: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 4,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: '#F0F8FE' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: '#E3F2FC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.primary },
  title: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.text },
  subtitle: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  warning: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.sm + 4,
    borderRadius: Radius.md,
  },
});
