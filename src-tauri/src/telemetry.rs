use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{WithExportConfig, WithTonicConfig};
use opentelemetry_sdk::{
    trace::{RandomIdGenerator, SdkTracerProvider},
    Resource,
};
use std::sync::{Mutex, OnceLock};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

static TRACER_PROVIDER: OnceLock<Mutex<Option<SdkTracerProvider>>> = OnceLock::new();

fn build_provider(
    endpoint: String,
) -> Result<SdkTracerProvider, opentelemetry_otlp::ExporterBuildError> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .with_tls_config(tonic::transport::ClientTlsConfig::new().with_enabled_roots())
        .build()?;
    Ok(SdkTracerProvider::builder()
        .with_id_generator(RandomIdGenerator::default())
        .with_resource(
            Resource::builder()
                .with_service_name("querymt-desktop")
                .build(),
        )
        .with_batch_exporter(exporter)
        .build())
}

pub fn setup() {
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:4317".to_string());
    let provider = match build_provider(endpoint) {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("Failed to initialize desktop OTLP exporter: {error}");
            return;
        }
    };
    let tracer = provider.tracer("querymt-desktop");
    let filter =
        EnvFilter::new(std::env::var("QMT_TELEMETRY_LEVEL").unwrap_or_else(|_| "info".to_string()));
    if tracing_subscriber::registry()
        .with(OpenTelemetryLayer::new(tracer).with_filter(filter))
        .try_init()
        .is_ok()
    {
        let _ = TRACER_PROVIDER.set(Mutex::new(Some(provider)));
    }
}

pub fn flush() {
    let Some(provider) = TRACER_PROVIDER
        .get()
        .and_then(|provider| provider.lock().ok())
        .and_then(|mut provider| provider.take())
    else {
        return;
    };
    let _ = provider.force_flush();
    let _ = provider.shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tonic_exporter_builds_inside_tauri_runtime() {
        tauri::async_runtime::block_on(async {
            let provider = build_provider("http://127.0.0.1:4317".to_string())
                .expect("OTLP provider should build when Tauri's Tokio reactor is active");
            let _ = provider.shutdown();
        });
    }
}
