use std::sync::Arc;

use agenthub::hub::Hub;
use agenthub::protocol::ServerMessage;
use tokio::sync::mpsc;

fn agent_tx() -> (mpsc::UnboundedSender<String>, mpsc::UnboundedReceiver<String>) {
    mpsc::unbounded_channel()
}

#[test]
fn register_and_connect() {
    let hub = Hub::new();
    let (tx_a, _) = agent_tx();
    let (tx_b, _) = agent_tx();
    hub.register("a".into(), vec!["test".into()], Some(tx_a), None)
        .unwrap();
    hub.register("b".into(), vec![], Some(tx_b), None).unwrap();
    hub.connect("a", "b").unwrap();

    let state = hub.state();
    match state {
        ServerMessage::State { agents, edges, .. } => {
            assert_eq!(agents.len(), 2);
            assert_eq!(edges.len(), 1);
        }
        _ => panic!("expected state"),
    }
}

#[test]
fn msg_requires_edge() {
    let hub = Hub::new();
    let (tx_a, _) = agent_tx();
    let (tx_b, _) = agent_tx();
    hub.register("a".into(), vec![], Some(tx_a), None).unwrap();
    hub.register("b".into(), vec![], Some(tx_b), None).unwrap();
    let err = hub.route_msg("a", "b", "hi").unwrap_err();
    assert!(matches!(err, ServerMessage::Error { .. }));
}

#[test]
fn msg_delivers_with_edge() {
    let hub = Hub::new();
    let (tx_a, _) = agent_tx();
    let (tx_b, mut rx_b) = agent_tx();
    hub.register("a".into(), vec![], Some(tx_a), None).unwrap();
    hub.register("b".into(), vec![], Some(tx_b), None).unwrap();
    hub.connect("a", "b").unwrap();
    hub.route_msg("a", "b", "hello").unwrap();
    let json = rx_b.try_recv().unwrap();
    assert!(json.contains("hello"));
}

#[test]
fn pty_message_avoids_shell_globs() {
    let line = agenthub::hub::pty_message_line("terminal-5", "run: ls");
    assert!(!line.contains("[terminal-5]")); // no bracket-wrapped name that shells glob-expand
    assert!(line.contains("terminal-5"));
    assert!(line.contains("run: ls"));
}
