<?php
namespace Sellio\Connector;

defined( 'ABSPATH' ) || exit;

final class Admin {
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_sellio_connector_action', array( __CLASS__, 'action' ) );
	}

	public static function menu() {
		add_submenu_page( 'woocommerce', __( 'Sellio Connector', 'sellio-connector' ), __( 'Sellio Connector', 'sellio-connector' ), 'manage_woocommerce', 'sellio-connector', array( __CLASS__, 'page' ) );
	}

	private static function redirect( $message ) {
		wp_safe_redirect( add_query_arg( 'sellio_message', rawurlencode( $message ), admin_url( 'admin.php?page=sellio-connector' ) ) );
		exit;
	}

	public static function action() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Brak uprawnień.', 'sellio-connector' ) );
		}

		check_admin_referer( 'sellio_connector_action' );
		$action = sanitize_key( $_POST['action_type'] ?? '' );

		if ( 'save' === $action ) {
			Settings::save( wp_unslash( $_POST ) );
			self::redirect( __( 'Ustawienia zapisano.', 'sellio-connector' ) );
		}

		if ( 'check' === $action ) {
			$result = Client::check();
			$settings = Settings::all();
			if ( is_wp_error( $result ) ) {
				$settings['verified_at'] = '';
				$settings['last_error'] = $result->get_error_message();
				update_option( Settings::OPTION, $settings, false );
				self::redirect( $result->get_error_message() );
			}
			$settings['verified_at'] = gmdate( 'c' );
			$settings['last_error'] = '';
			update_option( Settings::OPTION, $settings, false );
			self::redirect( __( 'Połączenie zostało zweryfikowane.', 'sellio-connector' ) );
		}

		if ( 'rotate_catalog' === $action ) {
			$token = bin2hex( random_bytes( 32 ) );
			update_option( 'sellio_connector_catalog_token_hash', hash( 'sha256', $token ), false );
			update_option( 'sellio_connector_catalog_token_created', gmdate( 'c' ), false );
			set_transient( 'sellio_connector_new_token_' . get_current_user_id(), $token, 300 );
			self::redirect( __( 'Wygenerowano nowy token katalogu. Wyświetlamy go jednorazowo poniżej.', 'sellio-connector' ) );
		}

		if ( 'retry' === $action ) {
			Queue::retry_failed();
			self::redirect( __( 'Nieudane zadania przekazano do ponowienia.', 'sellio-connector' ) );
		}

		if ( 'import' === $action ) {
			$total = Queue::start_import();
			self::redirect( sprintf( __( 'Zaplanowano import %d zamówień z ostatnich 30 dni w partiach po 50.', 'sellio-connector' ), $total ) );
		}

		if ( 'disconnect' === $action ) {
			Outbox::cancel_pending();
			Settings::disconnect();
			self::redirect( __( 'Rozłączono Sellio i anulowano oczekujące zadania.', 'sellio-connector' ) );
		}

		self::redirect( __( 'Nieznana akcja.', 'sellio-connector' ) );
	}

	private static function form( $type, $label, $class = 'secondary' ) {
		printf( '<form method="post" action="%s" style="display:inline-block;margin-right:8px">%s<input type="hidden" name="action" value="sellio_connector_action"><input type="hidden" name="action_type" value="%s"><button class="button %s">%s</button></form>', esc_url( admin_url( 'admin-post.php' ) ), wp_nonce_field( 'sellio_connector_action', '_wpnonce', true, false ), esc_attr( $type ), esc_attr( $class ), esc_html( $label ) );
	}

	public static function page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$settings = Settings::all();
		$new_token = get_transient( 'sellio_connector_new_token_' . get_current_user_id() );
		if ( $new_token ) {
			delete_transient( 'sellio_connector_new_token_' . get_current_user_id() );
		}

		$labels = array(
			'incomplete' => __( 'Konfiguracja nieuzupełniona', 'sellio-connector' ),
			'unverified' => __( 'Połączenie niesprawdzone', 'sellio-connector' ),
			'connected'  => __( 'Połączono', 'sellio-connector' ),
		);
		$status = $labels[ Settings::connection_status() ];
		?>
		<div class="wrap">
			<h1>Sellio Connector</h1>
			<?php if ( isset( $_GET['sellio_message'] ) ) : ?>
				<div class="notice notice-info"><p><?php echo esc_html( rawurldecode( $_GET['sellio_message'] ) ); ?></p></div>
			<?php endif; ?>
			<?php if ( $new_token ) : ?>
				<div class="notice notice-warning"><p><strong><?php esc_html_e( 'Token katalogu (pokaż tylko raz):', 'sellio-connector' ); ?></strong> <code><?php echo esc_html( $new_token ); ?></code></p></div>
			<?php endif; ?>
			<p><strong><?php echo esc_html( $status ); ?></strong>. <?php esc_html_e( 'Wyłączenie automatycznej wysyłki nie oznacza rozłączenia.', 'sellio-connector' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'sellio_connector_action' ); ?>
				<input type="hidden" name="action" value="sellio_connector_action">
				<input type="hidden" name="action_type" value="save">
				<table class="form-table">
					<tr><th>API Sellio</th><td><input class="regular-text" name="api_base_url" type="url" value="<?php echo esc_attr( $settings['api_base_url'] ); ?>" placeholder="https://api.sellio.example"></td></tr>
					<tr><th>ID sklepu</th><td><input class="regular-text" name="store_id" value="<?php echo esc_attr( $settings['store_id'] ); ?>"></td></tr>
					<tr><th>Token API</th><td><input class="regular-text" name="token" type="password" autocomplete="new-password" placeholder="<?php echo $settings['token'] ? esc_attr__( 'Pozostaw puste, aby zachować', 'sellio-connector' ) : ''; ?>"></td></tr>
					<tr><th>Automatyczna wysyłka</th><td><label><input type="checkbox" name="automatic" value="1" <?php checked( $settings['automatic'] ); ?>> <?php esc_html_e( 'Włączona', 'sellio-connector' ); ?></label></td></tr>
				</table>
				<button class="button button-primary"><?php esc_html_e( 'Zapisz ustawienia', 'sellio-connector' ); ?></button>
			</form>
			<hr>
			<p><?php printf( esc_html__( 'Ostatnia kontrola: %1$s; ostatnia udana wysyłka: %2$s; oczekujące: %3$d; nieudane: %4$d.', 'sellio-connector' ), esc_html( $settings['verified_at'] ?: '—' ), esc_html( $settings['last_success_at'] ?: '—' ), Outbox::pending_count(), Outbox::pending_count( true ) ); ?></p>
			<?php if ( $settings['last_error'] ) : ?><p><?php echo esc_html__( 'Ostatni błąd:', 'sellio-connector' ) . ' ' . esc_html( $settings['last_error'] ); ?></p><?php endif; ?>
			<?php self::form( 'check', __( 'Sprawdź połączenie', 'sellio-connector' ) ); ?>
			<?php self::form( 'import', __( 'Wyślij ostatnie 30 dni', 'sellio-connector' ) ); ?>
			<?php self::form( 'retry', __( 'Ponów nieudane', 'sellio-connector' ) ); ?>
			<?php self::form( 'rotate_catalog', __( 'Wygeneruj/rotuj token katalogu', 'sellio-connector' ) ); ?>
			<?php self::form( 'disconnect', __( 'Rozłącz', 'sellio-connector' ), 'delete' ); ?>
		</div>
		<?php
	}
}
