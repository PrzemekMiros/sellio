<?php
namespace Sellio\Connector;
defined( 'ABSPATH' ) || exit;
final class Crypto {
	private static function key() { return hash( 'sha256', wp_salt( 'auth' ) . ( defined( 'SELLIO_CONNECTOR_ENCRYPTION_KEY' ) ? SELLIO_CONNECTOR_ENCRYPTION_KEY : '' ), true ); }
	public static function encrypt( $plain ) { if ( ! function_exists( 'openssl_encrypt' ) ) { return ''; } $iv = random_bytes( 12 ); $tag = ''; $cipher = openssl_encrypt( $plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag ); return base64_encode( $iv . $tag . $cipher ); }
	public static function decrypt( $value ) { if ( ! function_exists( 'openssl_decrypt' ) || ! $value || false === ( $raw = base64_decode( $value, true ) ) || strlen( $raw ) < 29 ) { return ''; } return openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ) ) ?: ''; }
}
