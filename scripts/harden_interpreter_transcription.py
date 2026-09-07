from pathlib import Path

route = Path('artifacts/api-server/src/routes/sandra.ts')
text = route.read_text(encoding='utf-8')
start_marker = '  const sourceLanguage = target === "th" ? "de" : "th";'
end_marker = '  const sourceName = target === "th" ? "German" : "Thai";'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Interpreter transcription markers not found')
new = '''  const sourceLanguage = target === "th" ? "de" : "th";
  let heard = "";

  // Speech recognition is the most failure-prone part of the interpreter.
  // Try the fast transcription model first and transparently retry once with
  // the higher-capability transcription model before returning a speech error.
  for (const model of ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"] as const) {
    const transcriptionForm = new FormData();
    transcriptionForm.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mime }),
      fileName,
    );
    transcriptionForm.append("model", model);
    transcriptionForm.append("language", sourceLanguage);

    try {
      const transcriptionResponse = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: transcriptionForm,
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (!transcriptionResponse.ok) continue;
      const transcription = (await transcriptionResponse.json()) as {
        text?: unknown;
      };
      heard =
        typeof transcription.text === "string" ? transcription.text.trim() : "";
      if (heard) break;
    } catch {
      // Retry with the alternate transcription model below.
    }
  }

  if (!heard) return { ok: false, error: "speech" };

'''
text = text[:start] + new + text[end:]
route.write_text(text, encoding='utf-8')
assert text.count('gpt-4o-transcribe') >= 1
assert 'for (const model of ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"] as const)' in text
print('SANDRA_INTERPRETER_TRANSCRIPTION_HARDENING_OK')
