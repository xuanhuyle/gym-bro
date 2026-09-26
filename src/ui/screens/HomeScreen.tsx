import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { contextLabel } from '../../recording/schema';
import { importRecording, listRecordings, RecordingListItem } from '../../storage/recordingStore';
import { Button, Card, colors, styles } from '../components/common';

export function HomeScreen(props: { onNew: () => void; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<RecordingListItem[]>([]);
  const refresh = useCallback(() => {
    try {
      setItems(listRecordings());
    } catch (e) {
      Alert.alert('Could not read recordings', String(e));
    }
  }, []);
  useEffect(refresh, [refresh]);

  const onImport = async () => {
    try {
      const id = await importRecording();
      if (id) props.onOpen(id);
    } catch (e) {
      Alert.alert('Import failed', String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Gym Bro · Gate 0</Text>
      <Text style={[styles.muted, { marginBottom: 16 }]}>Motion recording experiment: can the iPhone count reps, sets and rest on a weight-stack machine?</Text>
      <Button title="New recording" onPress={props.onNew} big />
      <Button title="Import recording (.json)" kind="secondary" onPress={onImport} />
      <Text style={[styles.h2, { marginTop: 20 }]}>Recordings</Text>
      {items.length === 0 ? <Text style={styles.muted}>None yet.</Text> : null}
      {items.map(({ meta, interrupted, sizeBytes }) => {
        const dur = meta.startedAt && meta.stoppedAt ? (Date.parse(meta.stoppedAt) - Date.parse(meta.startedAt)) / 1000 : null;
        return (
          <Pressable key={meta.id} onPress={() => props.onOpen(meta.id)}>
            <Card>
              <Text style={styles.body}>{contextLabel(meta.context) || '(no exercise label)'}</Text>
              <Text style={styles.muted}>
                {new Date(meta.createdAt).toLocaleString()} · {dur != null ? `${Math.round(dur)} s` : '—'} · {(sizeBytes / 1e6).toFixed(1)} MB
                {meta.userReported ? ' · truth entered' : ''}
              </Text>
              {interrupted ? <Text style={{ color: colors.warn, fontSize: 13 }}>Interrupted (app closed while recording) — data up to last save is kept</Text> : null}
            </Card>
          </Pressable>
        );
      })}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
