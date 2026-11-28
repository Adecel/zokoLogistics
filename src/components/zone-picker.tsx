import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';
import type { RideZone } from '../lib/rides';

// Field that opens a searchable list of zones (arrondissements and quartiers)
export function ZonePicker({
  label,
  icon,
  zones,
  value,
  onChange,
  error,
}: {
  label: string;
  icon: 'radio-button-on' | 'flag';
  zones: RideZone[];
  value: string | null;
  onChange: (id: string) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = zones.find((z) => z.id === value);

  const list = useMemo(() => {
    const s = normalize(search.trim());
    return s ? zones.filter((z) => normalize(`${z.name} ${z.district ?? ''}`).includes(s)) : zones;
  }, [zones, search]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.input, { borderColor: error ? Colors.danger : Colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${selected?.name ?? 'choisir'}`}
      >
        <Ionicons name={icon} size={18} color={Colors.primary} />
        <View style={styles.flex1}>
          <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
            {selected?.name ?? 'Choisir un quartier ou un arrondissement'}
          </Text>
          {selected?.district ? <Text style={styles.district}>{selected.district}</Text> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalInner}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Fermer">
                <Ionicons name="close" size={26} color={Colors.text} />
              </Pressable>
            </View>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Rechercher un quartier…"
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
              />
            </View>
          </View>
          <FlatList
            data={list}
            keyExtractor={(z) => z.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalInner}
            ListEmptyComponent={<Text style={styles.empty}>Aucune zone ne correspond. Choisissez la plus proche.</Text>}
            renderItem={({ item }) => {
              const active = item.id === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.flex1}>
                    <Text style={[styles.rowName, active && { color: Colors.primary }]}>{item.name}</Text>
                    {item.district ? <Text style={styles.district}>{item.district}</Text> : null}
                  </View>
                  {active && <Ionicons name="checkmark" size={20} color={Colors.primary} />}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// Search without accents: "tie tie" finds "Tié-Tié"
function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-']/g, ' ')
    .toLowerCase();
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  field: { gap: Spacing.xs },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 52,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    backgroundColor: Colors.white,
  },
  value: { fontFamily: Fonts.medium, fontSize: 15, color: Colors.text },
  placeholder: { fontFamily: Fonts.regular, color: Colors.textMuted },
  district: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  error: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.danger },

  modal: { flex: 1, backgroundColor: Colors.background },
  modalInner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  modalTitle: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.navy },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, fontFamily: Fonts.regular, fontSize: 15, color: Colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowName: { fontFamily: Fonts.medium, fontSize: 15, color: Colors.text },
  empty: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.xl },
});
