import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const colors = {
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#1b1f24',
  muted: '#667085',
  border: '#d0d5dd',
  primary: '#1565c0',
  danger: '#c62828',
  good: '#2e7d32',
  warn: '#b26a00',
};

export function Button(props: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; big?: boolean; style?: ViewStyle }) {
  const kind = props.kind ?? 'primary';
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : colors.card;
  const fg = kind === 'secondary' ? colors.primary : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: props.disabled ? 0.4 : pressed ? 0.7 : 1, borderColor: kind === 'secondary' ? colors.primary : bg },
        props.big && styles.btnBig,
        props.style,
      ]}
    >
      <Text style={[styles.btnText, { color: fg }, props.big && styles.btnTextBig]}>{props.title}</Text>
    </Pressable>
  );
}

export function Card(props: { title?: string; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.card, props.style]}>
      {props.title ? <Text style={styles.cardTitle}>{props.title}</Text> : null}
      {props.children}
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#98a2b3" style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Chips<T extends string>(props: { options: readonly T[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {props.options.map((o) => (
        <Pressable key={o} onPress={() => props.onChange(o)} style={[styles.chip, props.value === o && styles.chipOn]}>
          <Text style={[styles.chipText, props.value === o && styles.chipTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Row(props: { label: string; value: React.ReactNode; tone?: 'good' | 'danger' | 'warn' }) {
  const color = props.tone ? colors[props.tone] : colors.text;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text style={[styles.rowValue, { color }]}>{props.value}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  h1: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13 },
  body: { color: colors.text, fontSize: 15 },
  mono: { fontFamily: 'Menlo', fontSize: 11, color: colors.text },
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1, marginVertical: 4 },
  btnBig: { paddingVertical: 28, borderRadius: 16 },
  btnText: { fontSize: 16, fontWeight: '600' },
  btnTextBig: { fontSize: 26, fontWeight: '800' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: colors.text },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, backgroundColor: '#fff', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.muted, fontSize: 14, flexShrink: 1, marginRight: 8 },
  rowValue: { fontSize: 14, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
});
