import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { contextLabel } from '../../recording/schema';
import { summarize } from '../../session/machine';
import { importRecording, listRecordings, RecordingListItem } from '../../storage/recordingStore';
import { Button, Card, colors, styles } from '../components/common';

function SessionLine({ item }: { item: RecordingListItem }) {
  const s = item.session!;
  const sum = summarize(s.state, s.state.watermarkSec);
  const sel = s.selection;
  const done = s.status === 'complete';
  return (
    <>
      <Text style={styles.body}>
        {sel.labels.exercise}
        {sel.labels.variant ? ` · ${sel.labels.variant}` : ''} · {s.loadKg != null ? `${s.loadKg} kg` : '— kg'}
      </Text>
      <Text style={styles.muted}>
        {new Date(item.meta.createdAt).toLocaleString()} · {sum.sets.length ? sum.sets.map((x) => x.reps).join(' / ') + ' reps' : 'no sets detected'}
        {item.meta.userReported ? ' · corrected' : ''}
      </Text>
      <Text style={{ color: done ? colors.good : colors.warn, fontSize: 13 }}>
        {done ? 'Complete' : `Interrupted — ${sum.sets.length} set(s) kept`}
      </Text>
    </>
  );
}

export function HomeScreen(props: { onNew: () => void; onOpen: (id: string) => void; devMode?: boolean; onDevMode?: (v: boolean) => void; onRawRecording?: () => void }) {
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
      <Text style={styles.h1}>Gym Bro</Text>
      <Text style={[styles.muted, { marginBottom: 16 }]}>Choose the exercise, strap the phone to the weight stack, press start once. Sets and rests are captured automatically.</Text>
      <Button title="Start exercise" onPress={props.onNew} big />
      {props.devMode ? (
        <Card title="Developer" style={{ marginTop: 12 }}>
          <Button title="Raw recording (free text, manual stop)" kind="secondary" onPress={() => props.onRawRecording?.()} />
          <Button title="Import recording (.json)" kind="secondary" onPress={onImport} />
        </Card>
      ) : null}
      <Text style={[styles.h2, { marginTop: 20 }]}>History</Text>
      {items.length === 0 ? <Text style={styles.muted}>None yet.</Text> : null}
      {items.map((item) => {
        const { meta, interrupted, sizeBytes } = item;
        const dur = meta.startedAt && meta.stoppedAt ? (Date.parse(meta.stoppedAt) - Date.parse(meta.startedAt)) / 1000 : null;
        return (
          <Pressable key={meta.id} onPress={() => props.onOpen(meta.id)}>
            <Card>
              {item.session ? (
                <SessionLine item={item} />
              ) : (
                <>
                  <Text style={styles.body}>{contextLabel(meta.context) || '(no exercise label)'}</Text>
                  <Text style={styles.muted}>
                    Raw recording · {new Date(meta.createdAt).toLocaleString()} · {dur != null ? `${Math.round(dur)} s` : '—'} · {(sizeBytes / 1e6).toFixed(1)} MB
                    {meta.userReported ? ' · truth entered' : ''}
                  </Text>
                  {interrupted ? <Text style={{ color: colors.warn, fontSize: 13 }}>Interrupted (app closed while recording) — data up to last save is kept</Text> : null}
                </>
              )}
            </Card>
          </Pressable>
        );
      })}
      {props.onDevMode ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <Text style={styles.muted}>Developer mode</Text>
          <Switch value={!!props.devMode} onValueChange={props.onDevMode} />
        </View>
      ) : null}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
