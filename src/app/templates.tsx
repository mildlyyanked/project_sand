import React, { useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { DEFAULT_TEMPLATES, TEMPLATE_INFO, type PromptTemplates } from '@/core/prompts';
import { useSettings } from '@/state/settings';
import { Button, Field, Row, Screen, T } from '@/ui/components';
import { space } from '@/ui/theme';

/** Every fixed piece of prompt text, editable, with reset. */
export default function Templates() {
  const db = useSQLiteContext();
  const { templates, setTemplates } = useSettings();
  const [draft, setDraft] = useState<Partial<PromptTemplates>>({});
  const keys = Object.keys(DEFAULT_TEMPLATES) as (keyof PromptTemplates)[];
  return (
    <Screen scroll>
      <T v="dim" style={{ marginBottom: space.lg }}>These are the app’s own words in every request. Presets and style cards carry the story’s voice; this is the scaffolding around them. Edits apply to the next request. The inspector shows exactly where each one lands.</T>
      {keys.map((k) => {
        const value = draft[k] ?? templates[k];
        const changed = templates[k] !== DEFAULT_TEMPLATES[k];
        const dirty = draft[k] != null && draft[k] !== templates[k];
        return (
          <View key={k} style={{ gap: 8, marginBottom: space.xl }}>
            <Row between>
              <T v="label">{TEMPLATE_INFO[k].label}{changed ? ' · edited' : ''}</T>
              {changed ? <Button small kind="ghost" title="Reset" onPress={async () => { await setTemplates(db, { [k]: DEFAULT_TEMPLATES[k] }); setDraft((d) => ({ ...d, [k]: undefined })); }} /> : null}
            </Row>
            <T v="faint">{TEMPLATE_INFO[k].hint}</T>
            <Field multiline value={value} onChangeText={(v) => setDraft((d) => ({ ...d, [k]: v }))} style={{ minHeight: k === 'craft' || k === 'plan' || k === 'critique' ? 160 : 80, fontSize: 14 }} />
            {dirty ? <Button small title="Save" onPress={async () => { await setTemplates(db, { [k]: draft[k]! }); setDraft((d) => ({ ...d, [k]: undefined })); }} /> : null}
          </View>
        );
      })}
    </Screen>
  );
}
