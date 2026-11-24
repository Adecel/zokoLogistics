import { StyleSheet } from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

// Shared layout for the account screens
export const accountStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  card: {
    padding: Spacing.md,
    gap: Spacing.sm + 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.navy },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  success: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.success,
    backgroundColor: Colors.successBg,
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },
});
