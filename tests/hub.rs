use std::sync::Arc;

use agenthub::hub::Hub;
use agenthub::protocol::ServerMessage;
use tokio::sync::mpsc;

fn agent_tx() -> mpsc::UnboundedSender<String> {
    let (tx, _rx) = mpsc::unbounded_channel();
    tx
}

#[test]
fn register_and_connect() {
    let hub = Hub::new();
    let tx_a = agent_tx();
    let tx_b = agent_tx();
    hub.register("a".into(), vec!["test".into()], tx_a).unwrap();
    hub.register("b".into(), vec![], tx_b).unwrap();
    hub.connect("a", "b").unwrap();

    let state = hub.state();
    match state {
        ServerMessage::State { agents, edges } => {
            assert_eq!(agents.len(), 2);
            assert_eq!(edges.len(), 1);
        }
        _ => panic!("expected state"),
    }
}

#[test]
fn msg_requires_edge() {
    let hub = Hub::new();
    hub.register("a".into(), vec![], agent_tx()).unwrap();
    hub.register("b".into(), vec![], agent_tx()).unwrap();
    let err = hub.route_msg("a", "b", "hi").unwrap_err();
    assert!(matches!(err, ServerMessage::Error { .. }));
}

#[test]
fn msg_delivers_with_edge() {
    let hub = Hub::new();
    let (tx_b, mut rx_b) = mpsc::unbounded_channel();
    hub.register("a".into(), vec![], agent_tx()).unwrap();
    hub.register("b".into(), vec![], tx_b).unwrap();
    hub.connect("a", "b").unwrap();
    hub.route_msg("a", "b", "hello").unwrap();
    let json = rx_b.try_recv().unwrap();
    assert!(json.contains("hello"));
}
