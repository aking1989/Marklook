import { Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { SearchHit } from "./searchCore";
import { SearchClient } from "./searchClient";

interface SearchPanelProps {
  onOpenResult: (path: string, line: number) => void;
  onRequestIndex: () => Promise<
    Array<{
      path: string;
      title: string;
      body: string;
      mtimeMs: number;
      size: number;
    }>
  >;
}

const QUERY_DEBOUNCE_MS = 150;

export function SearchPanel({
  onOpenResult,
  onRequestIndex,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [tookMs, setTookMs] = useState(0);
  const [status, setStatus] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const clientRef = useRef<import("./searchClient").SearchClient | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const client = new SearchClient();
    clientRef.current = client;

    const offResults = client.onResults((results, ms) => {
      setHits(results);
      setTookMs(ms);
      setSelectedIndex(0);
    });
    const offStatus = client.onStatus((state) => {
      setStatus(
        state.total > 0 && state.indexed < state.total
          ? `索引中 ${state.indexed}/${state.total}`
          : `共 ${state.fileCount} 个文件`,
      );
    });

    void onRequestIndex().then((docs) => {
      void client.reset(docs.map((doc) => ({ ...doc, id: doc.path })));
    });

    return () => {
      offResults();
      offStatus();
      client.dispose();
      clientRef.current = null;
    };
    // 面板挂载时建一次索引；工作区变化由父层重新挂载本组件触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    if (!query.trim()) {
      setHits([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      clientRef.current?.query(query);
    }, QUERY_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const highlighted = useMemo(() => {
    return hits.map((hit) => ({ hit, parts: splitSnippet(hit) }));
  }, [hits]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const hit = hits[selectedIndex];
      if (hit) onOpenResult(hit.path, hit.line);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div className="search-panel">
      <div className="search-input-row">
        <Search size={13} className="search-icon" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索工作区…"
          aria-label="搜索工作区"
          spellCheck={false}
        />
      </div>

      <p className="search-status">
        {status}
        {query.trim() && ` · ${hits.length} 条 · ${tookMs.toFixed(0)}ms`}
      </p>

      {highlighted.length > 0 && (
        <ul className="search-results">
          {highlighted.map(({ hit, parts }, index) => (
            <li key={hit.path}>
              <button
                className={`search-result${index === selectedIndex ? " selected" : ""}`}
                onClick={() => onOpenResult(hit.path, hit.line)}
                title={hit.path}
              >
                <span className="result-title">
                  {hit.title}
                  <span className="result-line">:{hit.line}</span>
                </span>
                <span className="result-snippet">
                  {parts.map((part, partIndex) =>
                    part.highlight ? (
                      <mark key={partIndex}>{part.text}</mark>
                    ) : (
                      <span key={partIndex}>{part.text}</span>
                    ),
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && hits.length === 0 && (
        <p className="search-empty">没有匹配的文档</p>
      )}
    </div>
  );
}

function splitSnippet(
  hit: SearchHit,
): Array<{ text: string; highlight: boolean }> {
  if (hit.ranges.length === 0) {
    return [{ text: hit.snippet, highlight: false }];
  }

  // 合并重叠区间后切分。
  const merged: Array<[number, number]> = [];
  for (const range of hit.ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range] as [number, number]);
    }
  }

  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push({ text: hit.snippet.slice(cursor, start), highlight: false });
    }
    parts.push({ text: hit.snippet.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < hit.snippet.length) {
    parts.push({ text: hit.snippet.slice(cursor), highlight: false });
  }
  return parts;
}
