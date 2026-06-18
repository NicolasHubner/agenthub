use serde::Deserialize;

fn hub_url() -> String {
    std::env::var("AGENTHUB_URL").unwrap_or_else(|_| {
        let port = std::env::var("AGENTHUB_PORT").unwrap_or_else(|_| "3000".into());
        format!("http://127.0.0.1:{port}")
    })
}

fn agent_name() -> Result<String, String> {
    std::env::var("AGENTHUB_NAME").map_err(|_| {
        "AGENTHUB_NAME not set (run inside an AgentHub terminal)".into()
    })
}

#[derive(Deserialize)]
struct StateSnap {
    #[serde(rename = "type")]
    kind: String,
    agents: Vec<AgentRow>,
    edges: Vec<[String; 2]>,
}

#[derive(Deserialize)]
struct AgentRow {
    name: String,
    connected: bool,
    tags: Vec<String>,
}

fn print_usage() {
    eprintln!(
        "AgentHub CLI — talk to linked agents on demand (Maestri-style)\n\
         \n\
         agenthub-cli list                                   List agents + links\n\
         agenthub-cli ask <to> <msg>                         Send message, blocks until reply\n\
         agenthub-cli reply <to> <msg>                       Reply to a pending ask\n\
         agenthub-cli peers                                  Linked agents from this terminal\n\
         agenthub-cli note [--to <title>] [--replace] <msg>  Write to connected notepad\n\
         \n\
         Env: AGENTHUB_NAME (auto in UI terminals), AGENTHUB_URL, AGENTHUB_PORT"
    );
}

fn fetch_state() -> Result<StateSnap, String> {
    let url = format!("{}/state", hub_url());
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("hub unreachable at {url}: {e}"))?;
    resp.into_json::<StateSnap>()
        .map_err(|e| format!("bad /state json: {e}"))
}

fn cmd_list() -> Result<(), String> {
    let snap = fetch_state()?;
    if snap.kind != "state" {
        return Err("unexpected /state payload".into());
    }
    println!("Agents:");
    for a in &snap.agents {
        let tags = if a.tags.is_empty() {
            String::new()
        } else {
            format!("  ({})", a.tags.join(", "))
        };
        println!(
            "  {}{} {}",
            a.name,
            tags,
            if a.connected { "" } else { "[offline]" }
        );
    }
    if snap.edges.is_empty() {
        println!("\nNo links. Connect terminals in the AgentHub canvas first.");
    } else {
        println!("\nLinks (message only flows when linked):");
        for [a, b] in &snap.edges {
            println!("  {a} ↔ {b}");
        }
    }
    Ok(())
}

fn cmd_peers() -> Result<(), String> {
    let me = agent_name()?;
    let snap = fetch_state()?;
    println!("You are: {me}");
    println!("Linked peers:");
    let mut any = false;
    for [a, b] in &snap.edges {
        if a == &me {
            println!("  {b}");
            any = true;
        } else if b == &me {
            println!("  {a}");
            any = true;
        }
    }
    if !any {
        println!("  (none — drag a cable in the canvas UI)");
    }
    Ok(())
}

fn cmd_ask(to: &str, message: &str) -> Result<(), String> {
    let from = agent_name()?;
    let url = format!("{}/msg", hub_url());
    let body = serde_json::json!({ "from": from, "to": to, "content": message, "awaiting_reply": true });
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(310))
        .send_string(&body.to_string())
        .map_err(|e| format!("send failed: {e}"))?;
    let status = resp.status();
    if status == 200 {
        if let Ok(data) = resp.into_json::<serde_json::Value>() {
            if let Some(reply) = data.get("reply").and_then(|r| r.as_str()) {
                println!("{reply}");
            }
        }
        return Ok(());
    }
    if status == 408 {
        return Err("timeout: no reply within 5 minutes".into());
    }
    if let Ok(err) = resp.into_json::<serde_json::Value>() {
        if let Some(reason) = err.get("reason").and_then(|r| r.as_str()) {
            return Err(reason.to_string());
        }
    }
    Err(format!("hub returned {status}"))
}

fn cmd_reply(to: &str, content: &str) -> Result<(), String> {
    let from = agent_name()?;
    let url = format!("{}/reply", hub_url());
    let body = serde_json::json!({ "from": from, "to": to, "content": content });
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("send failed: {e}"))?;
    let status = resp.status();
    if status == 204 {
        return Ok(());
    }
    if let Ok(err) = resp.into_json::<serde_json::Value>() {
        if let Some(reason) = err.get("reason").and_then(|r| r.as_str()) {
            return Err(reason.to_string());
        }
    }
    Err(format!("hub returned {status}"))
}

fn cmd_note(to: Option<&str>, content: &str, mode: &str) -> Result<(), String> {
    let from = agent_name()?;
    let url = format!("{}/note", hub_url());
    let body = serde_json::json!({
        "from": from,
        "to": to,
        "content": content,
        "mode": mode,
    });
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("send failed: {e}"))?;
    let status = resp.status();
    if status == 204 {
        return Ok(());
    }
    if let Ok(err) = resp.into_json::<serde_json::Value>() {
        if let Some(reason) = err.get("reason").and_then(|r| r.as_str()) {
            return Err(reason.to_string());
        }
    }
    Err(format!("hub returned {status}"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.as_slice() {
        [] => {
            print_usage();
            Ok(())
        }
        [cmd] if cmd == "help" || cmd == "-h" || cmd == "--help" => {
            print_usage();
            Ok(())
        }
        [cmd] if cmd == "list" => cmd_list(),
        [cmd] if cmd == "peers" => cmd_peers(),
        [cmd, to, msg] if cmd == "ask" && !msg.is_empty() => cmd_ask(to, msg),
        [cmd, to, rest @ ..] if cmd == "ask" => cmd_ask(to, &rest.join(" ")),
        [cmd, to, msg] if cmd == "reply" && !msg.is_empty() => cmd_reply(to, msg),
        [cmd, to, rest @ ..] if cmd == "reply" => cmd_reply(to, &rest.join(" ")),
        [cmd, rest @ ..] if cmd == "note" => {
            let mut to: Option<String> = None;
            let mut mode = "append".to_string();
            let mut content_parts: Vec<&str> = vec![];
            let mut iter = rest.iter();
            while let Some(arg) = iter.next() {
                match arg.as_str() {
                    "--to" => { to = iter.next().map(|s| s.as_str().to_string()); }
                    "--replace" => { mode = "replace".into(); }
                    "--append" => { mode = "append".into(); }
                    s => { content_parts.push(s); }
                }
            }
            if content_parts.is_empty() {
                eprintln!("usage: agenthub-cli note [--to <title>] [--replace] <content...>");
                Err("missing content".into())
            } else {
                cmd_note(to.as_deref(), &content_parts.join(" "), &mode)
            }
        }
        _ => {
            print_usage();
            Err("unknown command".into())
        }
    };
    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
