import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "../../lib/api-client.js";

export function AssetDirectoryPath(props: { onGetPath: () => Promise<string> }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const getPath = useRef(props.onGetPath);
  getPath.current = props.onGetPath;
  useEffect(() => {
    let active = true;
    void getPath.current().then((value) => {
      if (active) setPath(value);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof ApiClientError && reason.status === 404
        ? "请重新启动源码服务并刷新页面，以读取存放路径。"
        : reason instanceof ApiClientError && reason.status === 503
          ? "存放路径仅在本机桌面版显示。"
          : "暂时无法读取存放路径，不影响下载。");
    });
    return () => { active = false; };
  }, []);

  return (
    <footer className="asset-directory-path" aria-label="当前分类存放路径">
      <span>存放路径</span>
      {path ? <code>{path}</code> : <span>{error || "正在读取…"}</span>}
    </footer>
  );
}
