# encoding: UTF-8
require File.join(__dir__, 'ui_feedback')
require 'sketchup.rb'
require 'json'
require 'tempfile'
require 'weakref'
require 'base64'

# Compatibility with the already loaded 0.1.2 bootstrap: stage new support files
# inside its isolated generation before any live dialog is replaced.
%w[cutting production central reloader].each do |support|
  if is_a?(Module)
    container = const_get(:RQMyDina, false)
    unless container.const_defined?(support.capitalize, false)
      path = File.join(__dir__, "#{support}.rb")
      module_eval(File.read(path, encoding: 'UTF-8'), path, 1)
    end
  else
    require File.join(__dir__, support)
  end
end

# Older installed reloaders do not yet list these two files. Stage them from
# this release as well, so an in-session update works without a restart.
{'operation_contract.rb' => 'OperationContract', 'settings.rb' => 'Settings', 'selection_tool.rb' => 'PlanySelectionTool', 'command_mode.rb' => 'CommandMode'}.each do |filename, constant|
  if is_a?(Module)
    container = const_get(:RQMyDina, false)
    unless container.const_defined?(constant, false)
      path = File.join(__dir__, filename)
      module_eval(File.read(path, encoding: 'UTF-8'), path, 1)
    end
  else
    require File.join(__dir__, filename)
  end
end

module RQMyDina

  # The existing operation generation is also the lifetime of deferred work.
  # Panel-owned timers additionally use the F1 contract, never a second identity.
  def self.lifecycle_timer(delay, repeat = false, panel: false, &block)
    generation, contract = @operation_generation, (panel ? @operation_contract : nil)
    @lifecycle_timers ||= {}
    id = nil
    id = UI.start_timer(delay, repeat) do
      @lifecycle_timers.delete(id) unless repeat
      if generation && @operation_generation.equal?(generation) && (!panel || contract && contract.live?)
        block.call
      else
        UI.stop_timer(id) if repeat
        @lifecycle_timers.delete(id)
      end
    end
    @lifecycle_timers[id] = panel ? contract : :generation
    id
  end

  def self.cancel_lifecycle_timers(contract = nil)
    (@lifecycle_timers || {}).dup.each do |id, owner|
      next if contract && !owner.equal?(contract)
      begin
        UI.stop_timer(id)
      rescue StandardError => error
        warn "[Plany] Encerramento de timer: #{error.message}"
      ensure
        @lifecycle_timers.delete(id)
      end
    end
  end

  class AccessDenied < ArgumentError; end

  def self.authorized?
    @controller && @controller.respond_to?(:trial_allowed?) && @controller.trial_allowed? == true
  rescue StandardError
    false
  end

  def self.require_access!
    raise AccessDenied, 'Confirme o acesso de teste para usar o Plany.' unless authorized?
    true
  end

  def self.guarded_command
    require_access!
    yield
  rescue AccessDenied => error
    @controller.prompt_trial_access(error.message) if @controller.respond_to?(:prompt_trial_access)
    false
  end

  def self.suspend_access
    @scale_watcher.cancel if @scale_watcher
    operation_model_changed
    stop_generation_tools
    CommandMode.shutdown_native_keys
    send_to_panel('error'=>'Confirme o acesso de teste para continuar usando o Plany.')
  end

  def self.resume_access
    require_access!
    # Rebase, never reconcile edits made by native SketchUp while access was denied.
    @scale_watcher.snapshot if @scale_watcher
    activate_runtime if @controller.instance_variable_get(:@runtime).equal?(self)
  end

  def self.configure(controller, html)
    @controller, @ui_html = controller, html
    Geometry.bind_authorization { require_access! }
    @operation_generation = Object.new
    # Older bootstrap snapshots inline app.js but do not know this new script.
    @ui_html = @ui_html.sub('<script src="panel.js"></script>') { Reloader.script(File.join(__dir__, 'ui/panel.js')) }
    @ui_html = @ui_html.sub('<script src="../dimensions.js"></script>') { Reloader.script(File.join(__dir__, 'dimensions.js')) }
    @ui_html = @ui_html.sub('<script src="../glass.js"></script>') { Reloader.script(File.join(__dir__, 'glass.js')) }
    @ui_html = @ui_html.sub('<script src="operations.js"></script>') { Reloader.script(File.join(__dir__, 'ui/operations.js')) }
    @ui_html = @ui_html.sub('<script src="insertion-session.js"></script>') { Reloader.script(File.join(__dir__, 'ui/insertion-session.js')) }
    @ui_html = @ui_html.sub('<script src="recipe-changes.js"></script>') { Reloader.script(File.join(__dir__, 'ui/recipe-changes.js')) }
    @ui_html = @ui_html.sub('<script src="standards.js"></script>') { Reloader.script(File.join(__dir__, 'ui/standards.js')) }
    @ui_html = @ui_html.sub('<script src="editor-policy.js"></script>') { Reloader.script(File.join(__dir__, 'ui/editor-policy.js')) }
    @ui_html = @ui_html.sub('<link rel="stylesheet" href="standards.css">') { '<style>' + File.read(File.join(__dir__, 'ui/standards.css'), encoding: 'UTF-8') + '</style>' }
    @ui_html = @ui_html.sub('<script src="../piece-list-xlsx.js"></script>') { Reloader.script(File.join(__dir__, 'piece-list-xlsx.js')) }
    @ui_html = @ui_html.sub('<script src="../piece-export.js"></script>') { Reloader.script(File.join(__dir__, 'piece-export.js')) }
    @ui_html = @ui_html.sub('<link rel="stylesheet" href="../material-choice.css">') { '<style>' + File.read(File.join(__dir__, 'material-choice.css'), encoding: 'UTF-8') + '</style>' }
    @ui_html = @ui_html.sub('<script src="../material-choice.js"></script>') { Reloader.script(File.join(__dir__, 'material-choice.js')) }
    if @ui_html.match?(%r{<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["']stylesheet["']}i)
      raise ArgumentError, 'A interface do Plany ainda depende de arquivos externos à recarga.'
    end
    @source_identity = Reloader.identity(__dir__)
    # The old SketchUp bootstrap is intentionally stable. Once this generation
    # becomes active, load its controller/updater too, without a SketchUp restart.
    lifecycle_timer(0, false) do
      if controller.instance_variable_get(:@runtime).equal?(self)
        begin
          source = File.realpath(__dir__)
          release_root = File.expand_path(File.join(ENV.fetch('LOCALAPPDATA'), 'Plany', 'Releases'))
          if source.start_with?(release_root + File::SEPARATOR) &&
             controller.instance_variable_get(:@loaded_main_source) != source
            load File.join(source, 'main.rb')
            controller.instance_variable_set(:@loaded_main_source, source)
          end
        rescue StandardError, SyntaxError, LoadError => error
          warn "[Plany] Controlador da atualização não foi renovado: #{error.message}"
        end
        activate_runtime
      end
    end
  end

  def self.activate_runtime
    return unless authorized?
    return if @activation_done
    @activation_done = true
    controller = @controller
    # Already-open SketchUp sessions may still hold the old bootstrap command.
    icon = File.join(__dir__, 'ui', 'plany-toolbar-052.png')
    ObjectSpace.each_object(UI::Command) do |command|
      next unless command.respond_to?(:tooltip) && command.tooltip == 'Criar e ajustar módulos'
      command.small_icon = command.large_icon = icon
    end if File.file?(icon)
    # A 0.6.6 command remains attached to its native toolbar after a Ruby reload.
    # SketchUp has no remove_item. The previous cleanup reused the same native
    # toolbar name, which could append a second Plany command to the polluted
    # toolbar. Hide every legacy wrapper and replace it once with a uniquely
    # named toolbar containing only the principal command.
    legacy_opening = controller.instance_variable_get(:@opening_command)
    retired_toolbar = controller.instance_variable_get(:@retired_opening_toolbar)
    if (legacy_opening || retired_toolbar) && !controller.instance_variable_get(:@clean_toolbar)
      old_toolbar = controller.instance_variable_get(:@toolbar)
      legacy_toolbars = [old_toolbar, retired_toolbar].compact.uniq
      visible = legacy_toolbars.any? { |toolbar| toolbar.visible? }
      legacy_toolbars.each(&:hide)
      command = UI::Command.new('Plany — Criar e ajustar módulos') { controller.show_panel }
      command.tooltip = 'Criar e ajustar módulos'
      command.status_bar_text = 'Crie caixarias, divida vãos e inclua peças avulsas no mesmo módulo.'
      command.small_icon = command.large_icon = icon
      toolbar = UI::Toolbar.new('Plany principal')
      toolbar.add_item(command)
      toolbar.show if visible
      controller.instance_variable_set(:@retired_opening_toolbar, legacy_toolbars)
      controller.instance_variable_set(:@clean_toolbar, toolbar)
      controller.instance_variable_set(:@toolbar, toolbar)
      controller.remove_instance_variable(:@opening_command) if legacy_opening
    elsif controller.instance_variable_get(:@clean_toolbar)
      Array(retired_toolbar).compact.each(&:hide)
    end
    front_icon = File.join(__dir__, 'ui', 'toolbar-aprovada', 'frentes-normal.png')
    if (registered_front_command = controller.instance_variable_get(:@front_toggle_command))
      registered_front_command.small_icon = registered_front_command.large_icon = front_icon
    else
      front_command = UI::Command.new('Plany — Ocultar/mostrar frentes') { guarded_command { controller.load_runtime.toggle_fronts_from_toolbar } }
      front_command.tooltip = 'Ocultar frentes'
      front_command.status_bar_text = 'Alterna a visibilidade de todas as frentes Plany sem alterar as peças da produção.'
      front_command.small_icon = front_command.large_icon = front_icon
      controller.instance_variable_get(:@toolbar).add_item(front_command)
      controller.instance_variable_set(:@front_toggle_command, front_command)
    end
    controller.instance_variable_get(:@front_toggle_command).set_validation_proc { @fronts_hidden ? MF_CHECKED : MF_ENABLED }
    refresh_front_command
    select_icon = File.join(__dir__, 'ui', 'toolbar-aprovada', 'selecao-normal.png')
    unless controller.instance_variable_get(:@plany_select_command)
      select_command = UI::Command.new('Seleção Plany') { guarded_command { controller.load_runtime.activate_plany_selection } }
      select_command.tooltip = 'Seleção Plany · Ctrl seleciona a inserção inteira'
      select_command.status_bar_text = 'Aponte para uma peça Plany. Segure Ctrl para selecionar a inserção inteira.'
      select_command.small_icon = select_command.large_icon = select_icon
      controller.instance_variable_get(:@toolbar).add_item(select_command)
      controller.instance_variable_set(:@plany_select_command, select_command)
    end
    select_command = controller.instance_variable_get(:@plany_select_command)
    select_command.small_icon = select_command.large_icon = select_icon
    command = controller.instance_variable_get(:@plany_command_mode_command)
    command_tooltip = 'Modo Comandos · digite para criar, buscar, inserir ou executar ações'
    command_status = 'Ligue para digitar C, B, I ou A diretamente no modelo. Enter confirma.'
    unless command
      command = UI::Command.new('Modo Comandos') { guarded_command { controller.load_runtime.toggle_command_mode } }
      command.tooltip = command_tooltip
      command.status_bar_text = command_status
      command.small_icon = command.large_icon = File.join(__dir__, 'ui', 'toolbar-aprovada', 'modo-comandos-normal.png')
      controller.instance_variable_get(:@toolbar).add_item(command)
      controller.instance_variable_set(:@plany_command_mode_command, command)
    end
    unless controller.instance_variable_get(:@plany_command_mode_menu_registered)
      UI.menu('Tools').add_item(command)
      controller.instance_variable_set(:@plany_command_mode_menu_registered, true)
    end
    command.tooltip = command_tooltip
    command.status_bar_text = command_status
    command.set_validation_proc { controller.load_runtime.command_mode_active? ? MF_CHECKED : MF_ENABLED }
    refresh_command_mode_icon
    model = Sketchup.active_model
    active_tool = model.tools.active_tool
    model.select_tool(nil) if active_tool && active_tool.class.to_s.end_with?('RQMyDina::PieceScaleTool')
    begin
      repaired = Geometry.repair_context_offsets(model)
      puts "[Plany] Posições salvas recuperadas em #{repaired} módulo(s); geometria preservada." if repaired > 0
    rescue StandardError => error
      warn "[Plany] Recuperação de posições cancelada: #{error.message}"
    end
    begin
      repaired_seams = Geometry.refresh_cladding_seams(model)
      puts "[Plany] Emendas visuais corrigidas em #{repaired_seams} módulo(s)." if repaired_seams > 0
    rescue StandardError => error
      warn "[Plany] Correção das emendas cancelada: #{error.message}"
    end
    begin
      @material_cleanup_count = MaterialCatalog.with_operation_cache { Finishing.cleanup_invalid_mdf(model) }
    rescue StandardError => error
      @material_cleanup_count = 0
      warn "[Plany] Sincronização dos acabamentos salvos: #{error.message}"
    end
    begin
      @material_refresh_result = MaterialCatalog.with_operation_cache { MaterialCatalog.refresh_prepared_materials(model) }
    rescue StandardError => error
      @material_refresh_result = {'count' => 0, 'errors' => [{'name' => 'catálogo', 'message' => error.message}]}
      warn "[Plany] Atualização de texturas: #{error.message}"
    end
    begin
      @panel_finish_repair_result=Finishing.repair_panel_finishes(model)
      if @panel_finish_repair_result['count']>0
        send_to_panel('message'=>"Acabamentos de #{@panel_finish_repair_result['count']} ripado(s) atualizados. Ctrl+Z desfaz.")
      end
      if @panel_finish_repair_result['skipped'].any?
        send_to_panel('error'=>'Há ripados com geometria ou divisão diferente da receita. Abra Peças e materiais e aplique a configuração para atualizar: '+@panel_finish_repair_result['skipped'].join(', '))
      end
    rescue StandardError=>error
      warn "[Plany] Correção dos acabamentos do ripado: #{error.message}"
      send_to_panel('error'=>PlanyUiFeedback.user(error, 'atualizar os acabamentos do ripado'))
    end
    attach_observers if defined?(Sketchup::SelectionObserver)
    queue_selection if @panel_finish_repair_result && @panel_finish_repair_result['count']>0
    Reloader.record_identity(@source_identity)
    # The Central starts only when explicitly opened by the user.
    Central.remove_legacy_startup
    Central.prepare_clients_async if Central.respond_to?(:prepare_clients_async)
    begin
      Central.start_launcher(false, sync_only: true)
    rescue StandardError => error
      warn "[Plany] Não foi possível sincronizar o inicializador da Central: #{error.message}"
    end
    CommandMode.prepare_native_keys
  end

  def self.toggle_fronts_from_toolbar
    require_access!
    hidden = Finishing.toggle_fronts(Sketchup.active_model)
    refresh_front_command(hidden)
    Sketchup.set_status_text(hidden ? 'Frentes Plany ocultas no projeto.' : 'Frentes Plany restauradas no projeto.')
    sync_selection if @panel_ready
    hidden
  rescue StandardError => error
    PlanyUiFeedback.log(error)
    UI.messagebox(PlanyUiFeedback.user(error))
    false
  end

  def self.refresh_front_command(hidden = nil)
    command = @controller.instance_variable_get(:@front_toggle_command)
    return unless command
    hidden = Finishing.front_state(Sketchup.active_model, Finishing.boards(Sketchup.active_model, 'all'))['hidden'] if hidden.nil?
    @fronts_hidden = hidden
    icon = File.join(__dir__, 'ui', 'toolbar-aprovada', hidden ? 'frentes-ativo.png' : 'frentes-normal.png')
    command.small_icon = command.large_icon = icon
    command.tooltip = hidden ? 'Mostrar frentes' : 'Ocultar frentes'
  end

  def self.command_mode_active?
    !!(@command_tool && @command_tool.active?)
  end

  def self.refresh_command_mode_icon
    command = @controller.instance_variable_get(:@plany_command_mode_command)
    return unless command
    icon = File.join(__dir__, 'ui', 'toolbar-aprovada', command_mode_active? ? 'modo-comandos-ativo.png' : 'modo-comandos-normal.png')
    command.small_icon = command.large_icon = icon
  end

  def self.toggle_command_mode
    require_access!
    # A user-selected SketchUp shortcut invokes this UI::Command; pressing
    # it again must not interrupt Comandos. Esc / another native tool exit.
    activate_command_mode unless command_mode_active?
  end

  def self.activate_command_mode
    require_access!
    model = Sketchup.active_model
    model.select_tool(CommandMode::Tool.new(model, self))
  rescue StandardError => error
    PlanyUiFeedback.log(error)
    UI.messagebox(PlanyUiFeedback.user(error, 'iniciar o Modo Comandos'))
  end

  def self.command_mode_activated(tool)
    @command_tool = tool
    refresh_command_mode_icon
  end

  def self.command_mode_deactivated(tool)
    @command_tool = nil if @command_tool.equal?(tool)
    refresh_command_mode_icon
  end

  def self.command_module_selected?
    selected_module
    true
  rescue ArgumentError
    false
  end

  def self.execute_command_mode(parsed)
    require_access!
    id = parsed.fetch(:id)
    case parsed.fetch(:family)
    when 'c'
      if id == 'cabinet'
        params = Library.user_defaults.merge(parsed.fetch(:args))
        place(Parameters.normalize(params), nil, nil, nil, false, return_to_commands: true)
      else
        entry = CommandMode::COMMANDS.find { |item| item[:id] == id }
        raise ArgumentError, 'Peça desconhecida.' unless entry && entry[:piece]
        place_piece_from_command(entry[:piece], parsed.fetch(:args))
      end
    when 'b'
      place_library(id, nil, return_to_commands: true)
    when 'i'
      selected_module
      open_command_insert(id, parsed.fetch(:args)['quantity'])
    when 'a'
      model = Sketchup.active_model
      hidden = Finishing.front_state(model, Finishing.boards(model, 'all'))['hidden']
      if id == 'hide_fronts' && !hidden || id == 'show_fronts' && hidden
        toggle_fronts_from_toolbar
      elsif %w[hide_fronts show_fronts].include?(id)
        Sketchup.set_status_text(id == 'hide_fronts' ? 'As frentes já estão ocultas.' : 'As frentes já estão visíveis.')
      else
        raise ArgumentError, 'Ação não disponível.'
      end
    else
      raise ArgumentError, 'Família de comando inválida.'
    end
  end

  def self.open_command_insert(id, quantity)
    entry = CommandMode::COMMANDS.find { |item| item[:id] == id && item[:insert] }
    raise ArgumentError, 'Inserção não disponível.' unless entry
    @command_insert_payload = {'kind' => entry[:insert], 'quantity' => quantity}
    show_panel(true)
    deliver_command_insert if @panel_ready
  end

  def self.deliver_command_insert
    payload, @command_insert_payload = @command_insert_payload, nil
    return unless payload
    send_to_panel('command_insert' => payload)
  end

  def self.resume_command_mode_after_insert
    lifecycle_timer(0, false) do
      Sketchup.active_model.select_tool(nil) if @opening_tool
      @dialog.close if @dialog && @dialog.visible?
      activate_command_mode if Settings.load['command_stay_active']
    end
  end

  def self.activate_plany_selection
    require_access!
    model = Sketchup.active_model
    model.select_tool(PlanySelectionTool.new(model) { |path, group| open_plany_piece(path, group) })
  end

  def self.open_plany_piece(path, group, origin_list_id = nil)
    require_access!
    model = Sketchup.active_model
    @plany_piece_list_id = nil
    @plany_piece_return_id = origin_list_id
    raise ArgumentError, 'A peça não está mais disponível.' unless path.all?(&:valid?) && path.first.model == model
    owner_path = PlanySelectionTool.owner_path(path)
    @plany_focus_id = Graph.key(owner_path || path)
    @plany_focus_request = if owner_path
      role = path.last.get_attribute(Geometry::DICTIONARY, 'role').to_s
      relative_id = Graph.key(path.drop(owner_path.length))
      group ? { 'insertion' => PlanySelectionTool.insertion_key(path), 'role' => role.empty? ? "extra:#{relative_id}" : role } : { 'piece_role' => role.empty? ? "extra:#{relative_id}" : role }
    else
      { 'solo' => true }
    end
    show_panel
  end

  def self.clear_plany_focus
    @composite_root_id = nil
    @plany_focus_id = nil
    @plany_focus_request = nil
    @plany_piece_list_id = nil
    @plany_piece_return_id = nil
    @plany_selection_return = nil
  end

  def self.focused_paths(model)
    if @plany_selection_return && @plany_selection_return != native_selection_key(model)
      clear_plany_focus
    end
    return Graph.selection(model) unless @plany_focus_id
    path = Graph.resolve(model, @plany_focus_id)
    raise ArgumentError, 'A seleção mudou.' unless path.all?(&:valid?)
    [path]
  rescue ArgumentError
    clear_plany_focus
    Graph.selection(model)
  end

  def self.native_selection_key(model)
    [model.object_id, Graph.key(model.active_path || []), model.selection.map { |part| part.persistent_id }.sort]
  end

  def self.reloadable!
    raise ArgumentError, 'Conclua a inserção, edição ou busca do plano antes de recarregar.' if @placing || @editing || @search_token
    Sketchup.active_model.select_tool(nil) if @opening_tool || command_mode_active? || (@painting_tool && @painting_tool.active)
  end

  def self.safe_to_auto_reload?
    !@placing && !@editing && !@search_token && (!@dialog || !@dialog.visible?)
  end

  def self.source_identity; @source_identity; end
  def self.verified_reload_source; @verified_reload_source; end

  def self.reload_after_update(snapshot, open_panel = true)
    reloadable!
    if @reload_update_ready
      @reload_update_ready = false
      @reload_update_running = false
      @verified_reload_source ||= File.realpath(@controller.source_directory)
      return @controller.reload_runtime(self, snapshot, open_panel)
    end
    if @reload_update_running
      send_to_panel('update_status' => {'phase' => 'checking', 'detail' => 'A atualização já está em andamento. O progresso aparece aqui.'})
      return false
    end
    @reload_update_running = true
    send_to_panel('update_status' => {'phase' => 'checking', 'detail' => 'Consultando a versão oficial no GitHub.'})
    updater = @controller.const_get(:ReleaseUpdater)
    completed = operation_callback do |result|
      begin
        send_to_panel('update_status' => {'phase' => result['status'] == 'error' ? 'error' : 'ready',
                                          'version' => result['version'], 'detail' => result['detail']})
        if %w[current ready updated].include?(result['status'])
          @reload_update_ready = true
          @verified_reload_source = File.realpath(result['source_directory']) if result['status'] == 'ready'
          if @dialog && @dialog.visible? && @panel_ready
            # Capture a fresh panel snapshot after the asynchronous download.
            @dialog.execute_script('window.MyDina.activateOfficialUpdate();')
          else
            reload_after_update(snapshot, false)
          end
        else
          @reload_update_running = false
          send_to_panel('error' => "Não foi possível consultar a versão oficial. #{result['detail']}")
        end
      rescue StandardError => error
        @reload_update_ready = false
        @reload_update_running = false
        warn "[Plany] Atualização interrompida: #{error.full_message}"
        send_to_panel('error' => PlanyUiFeedback.user(error, 'ativar a atualização'))
      end
    end
    progress = operation_callback { |status| send_to_panel('update_status' => status) }
    @reload_update_listeners = [updater, completed, progress]
    updater.check_async(@source_identity['version'], progress: progress, &completed)
    true
  rescue StandardError => error
    @reload_update_ready = false
    @reload_update_running = false
    warn "[Plany] Recarga interrompida: #{error.full_message}"
    send_to_panel('error' => PlanyUiFeedback.user(error, 'recarregar o Plany'))
    false
  end

  def self.request_reload
    reloadable!
    if @dialog && @dialog.visible? && @panel_ready
      @reload_request = token = Object.new
      @dialog.execute_script('if(window.planyInitialized && window.MyDina){window.MyDina.requestReload();}else{sketchup.reload_plugin(null);}')
      lifecycle_timer(1.0, false, panel: true) do
        if @reload_request.equal?(token)
          @reload_request = nil
          reload_after_update(nil)
        end
      end
    else
      reload_after_update(nil)
    end
  rescue StandardError => error
    PlanyUiFeedback.log(error)
    UI.messagebox(PlanyUiFeedback.user(error))
  end

  def self.export_reload_state(snapshot)
    reloadable!
    return nil unless snapshot
    raise ArgumentError, 'Não foi possível preservar o painel.' unless snapshot.is_a?(Hash)
    {
      'params' => Parameters.normalize(snapshot['params'], validate_stock: false),
      'elevation' => snapshot['elevation'], 'chosen_material' => snapshot['chosen_material'],
      'target_id' => snapshot['target_id'], 'dirty' => !!snapshot['dirty'],
      'selected' => snapshot['selected'].to_s,
      'tab' => %w[module extras library production materials].include?(snapshot['tab']) ? snapshot['tab'] : 'module',
      'drafts' => snapshot['drafts'],
      'target_model' => @target_model
    }
  end

  def self.prepare_reload_state(state)
    if state
      state = state.merge('params' => Parameters.from_saved(state['params']))
    end
    @reload_state = state
    @target_model = state && state['target_model']
  end

  def self.restore_panel_state
    state, @reload_state = @reload_state, nil
    payload = state.reject { |key, _| key == 'target_model' }
    payload['restored'] = true
    payload['extras'] = []
    if state['target_id']
      begin
        instance = selected_module(state['target_id'])
        payload['extras'] = Geometry.extra_data(instance)
        payload['base_params'] = Geometry.read(instance)
        payload['elevation'] ||= Finishing.elevation(Graph.resolve(@target_model, state['target_id']))
        payload['piece_elevations'] = Finishing.piece_elevations(Graph.resolve(@target_model, state['target_id']))
      rescue ArgumentError
        payload['target_id'] = nil
      end
    end
    payload['selection_kind'] = payload['target_id'] ? 'module' : 'empty'
    payload['selection_key'] = payload['target_id'] && @target_model.object_id.to_s + ':' + payload['target_id'].to_s
    payload['message'] = "Plany #{@source_identity['version']} carregado." + (state['dirty'] ? ' Suas alterações no painel foram mantidas; aplique quando quiser.' : '')
    send_to_panel(payload)
  end

  def self.close_for_reload
    @reload_request = nil
    @operation_generation = nil
    @operation_contract.close if @operation_contract
    cancel_lifecycle_timers
    if @reload_update_listeners
      updater, completed, progress = @reload_update_listeners
      updater.unsubscribe(completed, progress) if updater.respond_to?(:unsubscribe)
      @reload_update_listeners = nil
    end
    Central.dispose if Central.respond_to?(:dispose)
    stop_generation_tools
    CommandMode.shutdown_native_keys
    detach_observers
    @dialog.close if @dialog
    @panel_close.call if @panel_close
    @dialog = @operation_contract = @target_model = @pending_payload = nil
    @panel_ready = false
    MaterialCatalog.invalidate_document
  end

  def self.stop_generation_tools
    tools = [@active_tool, @opening_tool, @painting_tool, @command_tool, @material_picker].compact.uniq
    tools.each do |tool|
      model = tool.instance_variable_get(:@model)
      begin
        model.select_tool(nil) if model && model.valid? && model.tools.active_tool.equal?(tool)
      rescue StandardError => error
        warn "[Plany] Encerramento de ferramenta: #{error.message}"
      ensure
        keys = tool.instance_variable_get(:@native_keys)
        keys.stop if keys
      end
    end
    @active_tool = @opening_tool = @painting_tool = @command_tool = @material_picker = nil
    @placing = @editing = false
    clear_plany_focus
  end

  # Keep the source snapshot until reload promotion succeeds, for rollback.
  def self.release_generation
    @ui_html = @reload_state = @production = @production_model = @cut_search = @cut_plan = @piece_export_pending = @production_context = @production_partial = nil
  end
  def self.send_to_panel(payload)
    return unless @dialog
    unless @panel_ready
      @pending_payload = [payload, @operation_generation, Sketchup.active_model, @operation_contract && @operation_contract.revision]
      return
    end
    payload = @operation_contract.envelope(payload) if @operation_contract
    return unless payload
    if payload['selection_event'] && @mdf_recovery_notice
      payload['mdf_recovery_notice'] = @mdf_recovery_notice
      @mdf_recovery_notice = nil
    end
    json = JSON.generate(payload).gsub("\u2028", '\\u2028').gsub("\u2029", '\\u2029')
    @dialog.execute_script("window.MyDina.receive(#{json});")
  end

  def self.handle
    require_access!
    @scale_watcher.flush if @scale_watcher
    @operation_contract.validate_context! if @operation_contract
    PieceOrientation.clear_notice
    MaterialCatalog.with_operation_cache { yield }
    notice = PieceOrientation.take_notice
    send_to_panel('message'=>notice) if notice
  rescue StandardError => error
    PieceOrientation.clear_notice
    PlanyUiFeedback.log(error)
    message = PlanyUiFeedback.user(error)
    send_to_panel('error' => message, 'error_detail' => PlanyUiFeedback.diagnostic(error.message))
    sync_selection if error.is_a?(OperationContract::StaleTarget)
  end

  def self.selected_module(target_id = nil)
    model = Sketchup.active_model
    paths = focused_paths(model)
    raise ArgumentError, 'Selecione um único módulo Plany.' unless paths.length == 1 && Geometry.module?(paths.first.last)
    path = paths.first
    instance = Geometry.validate_instance!(model, path.last)
    if target_id && (@target_model != model || Graph.key(path) != target_id.to_s)
      raise ArgumentError, 'A seleção ou o projeto mudou. Confira o módulo selecionado.'
    end
    instance
  end

  def self.rebind_piece_owner(path)
    if @composite_root_id
      @composite_root_id=Graph.key(path.take(@composite_root_id.split('/').length))
    end
    @plany_focus_id=Graph.key(path)
  end

  def self.module_context(path)
    children = Geometry.module_children(path)
    descriptor = Geometry.module_descriptor(path, children)
    {'module_descriptor'=>descriptor, 'module_children'=>children,
     'carcasses'=>children.select { |item| item['family']=='cabinet' },
     'module_inventory'=>descriptor['capabilities']['summary'] ? Finishing.module_inventory(path) : nil}
  end

  def self.send_instance(instance, message, previous_target = nil, piece_role = nil)
    @target_model = Sketchup.active_model
    path = focused_paths(@target_model).find { |p| p.last == instance } || [instance]
    send_to_panel('selection_kind' => 'module', 'params' => Geometry.read(instance), 'target_id' => Graph.key(path),
                  'elevation' => Finishing.elevation(path),
                  'piece_elevations' => Finishing.piece_elevations(path),
                  'selection_key' => @target_model.object_id.to_s + ':' + Graph.key(path),
                  'applied' => true, 'activate_tab' => 'module',
                  'extras' => Geometry.extra_data(instance, path), 'module_materials' => Finishing.module_mdf_materials(instance),
                  'composite_root_id' => @composite_root_id,
                  'retargeted_from' => previous_target,
                  'applied_piece_role' => piece_role,
                  'message' => message, **module_context(path))
  end

  def self.show_panel(load_selection = false)
    require_access!
    @operation_generation ||= Object.new
    attach_observers if defined?(Sketchup::SelectionObserver)
    @dialog ||= create_dialog
    @dialog.visible? ? @dialog.bring_to_front : @dialog.show
    sync_selection if @panel_ready && defined?(Sketchup::SelectionObserver)
    if load_selection
      if @panel_ready
        handle { send_instance(selected_module, 'Módulo carregado para edição.') }
      else
        @load_selection = true
      end
    end
  end

  def self.show_settings
    require_access!
    @open_settings_on_ready = true
    show_panel
    if @panel_ready
      @open_settings_on_ready = false
      send_to_panel('open_settings' => true)
    end
  end

  # Closing is supported since 2017; HtmlDialog#hide only exists since 2026.1.
  # Defer the close until the CEF callback has returned and rebuild callbacks
  # when the tool finishes. Always clear flags, including activation failures.
  def self.start_model_tool(model, tool, flag, snapshot = nil, quiet: false)
    require_access!
    @reload_state = export_reload_state(snapshot) if snapshot
    instance_variable_set(flag, true)
    @active_tool = tool
    generation = @operation_generation
    lifecycle_timer(0, false) do
      next unless generation && @operation_generation.equal?(generation) && @active_tool.equal?(tool) && Sketchup.active_model == model
      begin
        @dialog.close if @dialog
        model.select_tool(tool)
      rescue StandardError => error
        tool.release_unused_source if tool.respond_to?(:release_unused_source)
        instance_variable_set(flag, false)
        @active_tool = nil
        if quiet
          Sketchup.set_status_text("Modo Comandos: #{error.message}")
          activate_command_mode if Settings.load['command_stay_active']
        else
          show_panel
          send_to_panel('error' => PlanyUiFeedback.user(error, 'iniciar a ferramenta'))
        end
      end
    end
  end

  def self.place_library(id, snapshot = nil, return_to_commands: false)
    require_access!
    Settings.require_thickness!
    model = Sketchup.active_model
    Geometry.ensure_root!(model)
    params, definition, behavior, temporary, identity = Library.source(model, id, deferred: true)
    place(params, definition, snapshot, behavior, temporary, return_to_commands: return_to_commands, identity: identity)
  end

  def self.place(params, definition = nil, snapshot = nil, behavior = nil, temporary = false, return_to_commands: false, identity: nil)
    require_access!
    Settings.require_thickness!
    model = Sketchup.active_model
    previous_selection = model.selection.to_a
    Geometry.ensure_root!(model)
    generation = @operation_generation
    tool = PlacementTool.new(model, params, definition, behavior, **(identity ? {identity: identity} : {})) do |result|
      next unless generation && @operation_generation.equal?(generation) && @active_tool.equal?(tool) && Sketchup.active_model == model
      @placing = false
      @active_tool = nil
      model.selection.clear
      previous_selection.each { |entity| model.selection.add(entity) if entity.valid? }
      if return_to_commands
        if result['instance'] && result['instance'].valid?
          Sketchup.set_status_text('Módulo posicionado. Digite outro comando.')
        else
          Sketchup.set_status_text(result['error'] ? "Modo Comandos: #{result['error']}" : 'Inserção cancelada. Digite outro comando.')
        end
        activate_command_mode if Settings.load['command_stay_active']
      else
        show_panel
        if result['instance'] && result['instance'].valid?
          send_instance(result['instance'], result['message'])
        else
          send_to_panel(result)
          UI.messagebox('Não foi possível inserir o módulo. Confira a seleção e tente inserir novamente.') if result['error']
        end
      end
    end
    return_to_commands ? Sketchup.set_status_text('Clique no projeto para posicionar. Esc cancela.') : send_to_panel('message' => 'Clique no projeto para posicionar. Esc cancela.')
    tool.mark_temporary_source(temporary)
    tool.completion_scheduler = method(:lifecycle_timer)
    start_model_tool(model, tool, :@placing, snapshot, quiet: return_to_commands)
  end

  def self.place_piece_library(id, snapshot = nil, return_to_commands: false, dimensions: nil)
    require_access!
    if id == 'piece:baseboard'
      params = Library.baseboard_starter['params']
      params.merge!(%w[width depth height].zip(dimensions).to_h) if dimensions && !dimensions.empty?
      return place(params, nil, snapshot, nil, false, return_to_commands: return_to_commands)
    end
    model = Sketchup.active_model
    previous_selection = model.selection.to_a if return_to_commands
    Geometry.ensure_root!(model)
    entry, definition, temporary = Library.piece_source(model, id, deferred: true)
    Settings.require_thickness! unless entry.dig('settings', 'construction_type') == 'glass'
    if dimensions && !dimensions.empty?
      entry = entry.merge('size' => entry['size'].dup)
      thickness_axis = entry['axis']
      axes = [0, 1, 2] - [thickness_axis]
      length_axis = axes.max_by { |axis| entry['size'][axis] }
      width_axis = (axes - [length_axis]).first
      entry['size'][length_axis], entry['size'][width_axis], entry['size'][thickness_axis] = dimensions
      Library.validate_piece(entry)
    end
    generation = @operation_generation
    tool = PiecePlacementTool.new(model, entry, definition) do |result|
      next unless generation && @operation_generation.equal?(generation) && @active_tool.equal?(tool) && Sketchup.active_model == model
      @placing = false
      @active_tool = nil
      @reload_state = nil if result['piece']
      if return_to_commands
        model.selection.clear
        previous_selection.each { |entity| model.selection.add(entity) if entity.valid? }
        if result['piece'] && result['piece'].valid?
          Sketchup.set_status_text('Peça posicionada. Digite outro comando.')
        else
          Sketchup.set_status_text(result['error'] ? "Modo Comandos: #{result['error']}" : 'Inserção cancelada. Digite outro comando.')
        end
        activate_command_mode if Settings.load['command_stay_active']
      else
        show_panel
        send_to_panel(result.reject { |key, _| key == 'piece' }.merge('activate_tab' => 'module'))
        queue_selection
      end
    end
    tool.mark_temporary_source(temporary)
    start_model_tool(model, tool, :@placing, snapshot, quiet: return_to_commands)
  end

  def self.place_piece_from_command(id, dimensions)
    require_access!
    place_piece_library(id, nil, return_to_commands: true, dimensions: dimensions)
  end

  def self.open_central_job(id = nil, install_runtime: false)
    require_access!
    @central_pending_job = id
    send_to_panel('central_setup' => {'step' => 'preparing'}) if install_runtime || (!Central.running? && !Central.runtime_ready?)
    completed = operation_callback do |error, result|
      if error
        setup = (install_runtime || %w[runtime_missing runtime_install_failed].include?(result)) ? {'step' => 'runtime', 'detail' => error} : nil
        send_to_panel((setup ? {'central_setup' => setup} : {}).merge('error' => error))
      elsif result == 'app'
        send_to_panel('central_setup' => {'step' => 'linked'}, 'message' => 'Plano aberto na Central Plany instalada.')
      else
        send_to_panel('central_setup' => {'step' => 'app'}, 'message' => 'Central aberta no navegador. Instale-a como app para abrir os próximos planos diretamente nela.')
      end
    end
    Central.open(id, install_runtime: install_runtime, &completed)
  end

  def self.create_dialog
    @panel_ready = false
    dialog = WeakRef.new(UI::HtmlDialog.new(
      dialog_title: 'Plany — Módulos', preferences_key: 'rq_mydina.panel',
      scrollable: true, resizable: true, width: 490, height: 850,
      min_width: 390, min_height: 600, style: UI::HtmlDialog::STYLE_DIALOG
    ))
    @dialog = dialog.__getobj__
    @dialog.extend(OperationCallbacks)
    @operation_contract = OperationContract.new(self, @dialog)
    dialog.operation_contract = @operation_contract
    # set_html uses shared suwebviewtmp names across SketchUp processes. Give
    # each generation its own document so other instances cannot overwrite it.
    document = Tempfile.new(['plany-panel-', '.html'])
    document.binmode
    document.write(@ui_html.encode('UTF-8'))
    document.flush
    dialog.set_file(document.path)
    register_workshop_callbacks(dialog)
    dialog.add_action_callback('ready') do |_context|
      next unless @dialog.equal?(dialog.__getobj__)
      @panel_ready = true
      defaults = Library.user_defaults
      initial = {
        'params' => defaults,
        'defaults' => defaults,
        'ready' => true,
        'settings' => Settings.load,
        'command_catalog' => CommandMode.catalog,
        'catalog' => MaterialCatalog.available(Sketchup.active_model),
        'material_sources' => MaterialCatalog::SOURCES
      }
      send_to_panel(initial)
      restore_panel_state if @reload_state
      if @pending_payload
        pending, @pending_payload = @pending_payload, nil
        if pending[1].equal?(@operation_generation) && pending[2].equal?(Sketchup.active_model) && pending[3] == @operation_contract.revision
          @operation_contract.event { send_to_panel(pending[0]) }
        end
      end
      if @load_selection
        @load_selection = false
        handle { send_instance(selected_module, 'Módulo carregado para edição.') }
      end
      sync_selection if defined?(Sketchup::SelectionObserver)
      if @open_settings_on_ready
        @open_settings_on_ready = false
        send_to_panel('open_settings' => true)
      end
      deliver_command_insert
      if @controller.respond_to?(:take_update_failure)
        update_failure = @controller.take_update_failure
        @operation_contract.event { send_to_panel('error' => update_failure) } if update_failure
      end
    rescue StandardError => error
      warn "[Plany] Falha ao preparar painel: #{error.full_message}"
      send_to_panel('error' => PlanyUiFeedback.user(error, 'preparar o painel'))
    end
    dialog.add_action_callback('reload_plugin') do |_context, snapshot|
      @reload_request = nil
      # Finish the CEF callback before replacing its dialog.
      lifecycle_timer(0, false) { reload_after_update(snapshot) }
    end
    dialog.add_action_callback('read_selection') do |_context|
      handle { send_instance(selected_module, 'Módulo carregado. Ajuste as medidas e aplique.') }
    end
    dialog.add_action_callback('recover_operation') do |_context, original|
      handle do
        result=dialog.operation_contract.recover(original)
        send_to_panel('operation_recovery'=>result)
        sync_selection unless result['status']=='running'
      end
    end
    dialog.add_action_callback('save_defaults') do |_context, raw|
      handle { send_to_panel('defaults' => Library.save_defaults(raw), 'library' => Library.list,
        'message' => 'Seu padrão foi salvo para novos módulos. Os existentes mantêm suas configurações.') }
    end
    dialog.add_action_callback('save_settings') do |_context, raw|
      handle do
        saved = Settings.save(raw)
        @command_tool.refresh_settings if command_mode_active?
        send_to_panel('settings' => saved, 'defaults' => Library.user_defaults,
          'message' => 'Configurações salvas para as próximas inserções. Os módulos existentes foram preservados.')
      end
    end
    dialog.add_action_callback('resume_commands') do |_context|
      resume_command_mode_after_insert
    end
    dialog.add_action_callback('set_extra_data') do |_context, target_id, part_id, raw, elevation|
      handle do
        instance = selected_module(target_id)
        applied_role = nil
        instance = Geometry.set_extra_data(Sketchup.active_model, instance, part_id, raw, elevation: elevation,
          owner_path: Graph.resolve(Sketchup.active_model, target_id)) do |path, relative|
            rebind_piece_owner(path);applied_role="extra:#{Graph.key(relative)}"
          end
        send_instance(instance, 'Ficha da peça avulsa salva no módulo.', target_id, applied_role)
      end
    end
    dialog.add_action_callback('edit_divisions') do |_context, target_id, snapshot|
      handle do
        instance = selected_module(target_id)
        generation, model = @operation_generation, Sketchup.active_model
        tool = DivisionTool.new(Sketchup.active_model, instance) do |result|
          next unless generation && @operation_generation.equal?(generation) && @active_tool.equal?(tool) && Sketchup.active_model == model
          @editing = false
          @active_tool = nil
          show_panel
          if result['error']
            send_to_panel(result)
          elsif instance.valid? && !Sketchup.active_model.active_path && instance.model == Sketchup.active_model
            send_instance(instance, result['message'])
          else
            send_to_panel('message' => 'Edição encerrada. Use a seleção para carregar o módulo novamente.')
          end
        end
        start_model_tool(Sketchup.active_model, tool, :@editing, snapshot)
      end
    end
    dialog.add_action_callback('update_module') do |_context, raw, target_id, elevation, restore_excluded, piece_position|
      handle do
        instance = selected_module(target_id)
        model = Sketchup.active_model
        raise ArgumentError, 'A elevação absoluta pertence ao módulo.' if piece_position
        # Reject recipe constraints before any transaction or Graph.unique write.
        # Aborting a no-op would otherwise advance the revision and close the editor.
        Parameters.normalize(raw, previous: Geometry.read(instance))
        path = nil
        ScaleWatcher.with_local_edit(@scale_watcher, [Graph.resolve(model, target_id)]) do
          Workshop.batch(model) do
            path = Graph.unique(Graph.resolve(model, target_id))
            instance = path.last
            Geometry.update(model, instance, raw, restore_excluded: restore_excluded == true)
            Finishing.set_elevation(path, elevation) unless elevation.nil?
            Finishing.finish_module(model, path)
          end
        end
        rebind_piece_owner(path)
        send_instance(instance, 'Módulo atualizado. As peças avulsas foram preservadas.', target_id)
      end
    end
    dialog.add_action_callback('include_parts') do |_context, rule|
      handle do
        model = Sketchup.active_model
        selection = model.selection.to_a
        modules = selection.select { |e| Geometry.module?(e) }
        raise ArgumentError, 'Selecione no SketchUp uma caixaria junto com as peças avulsas que deseja incluir.' unless modules.length == 1
        instance = modules.first
        instance = Geometry.include_parts(model, instance, selection - [instance], rule)
        send_instance(instance, 'Peças incluídas. Agora fazem parte do mesmo módulo.')
      end
    end
    dialog.add_action_callback('set_rule') do |_context, target_id, part_id, rule|
      handle do
        instance = selected_module(target_id)
        instance = Geometry.set_rule(Sketchup.active_model, instance, part_id, rule)
        send_instance(instance, 'Comportamento da peça salvo.')
      end
    end
    dialog.add_action_callback('list_library') do |_context|
      handle { send_to_panel('library' => Library.list) }
    end
    dialog.add_action_callback('model_behavior') do |_context, id|
      handle { send_to_panel('model_behavior' => Library.model_behavior(Sketchup.active_model, id)) }
    end
    dialog.add_action_callback('save_model_behavior') do |_context, id, behavior|
      handle do
        entry = Library.save_behavior(Sketchup.active_model, id, behavior)
        send_to_panel('library' => Library.list, 'model_behavior' => { 'id' => id, 'name' => entry['name'], 'parts' => entry['behavior'] },
                      'message' => 'Comportamento deste modelo salvo.')
      end
    end
    dialog.add_action_callback('save_piece_library') do |_ctx, id|
      handle do
        paths=Graph.selection(Sketchup.active_model)
        raise ArgumentError, 'Selecione uma única peça Plany.' unless paths.length==1 && Graph.key(paths.first)==id
        Library.save_piece(paths.first)
        send_to_panel('library'=>Library.list, 'message'=>'Peça guardada na Biblioteca.')
      end
    end
    dialog.add_action_callback('insert_piece_library') do |_ctx,id,snapshot|
      handle do
        place_piece_library(id, snapshot)
      end
    end
    dialog.add_action_callback('set_selected_rule') do |_ctx,id,raw|
      handle do
        model=Sketchup.active_model;paths=Graph.selection(model)
        raise ArgumentError, 'A seleção mudou.' unless paths.length==1 && Graph.key(paths.first)==id
        path=paths.first;owner=path[0...-1].reverse.find { |p| Geometry.module?(p) }
        raise ArgumentError, 'Selecione uma peça avulsa dentro do módulo.' unless owner && Graph.registered?(path.last) && !path.last.get_attribute(Geometry::DICTIONARY,'role')
        Geometry.read(owner)
        rule=Rules.normalize(raw)
        Geometry.transaction(model,'Plany: comportamento da peça') do
          path=Graph.unique(path);part=path.last
          Workshop.validate_rule(part,rule)
          axis=Finishing.axis(part);owner_index=path.rindex { |p| Geometry.module?(p) }
          local=Graph.axes(Graph.transform(path[(owner_index+1)..-1]))[axis]
          direction=local.to_a.each_index.max_by { |i| local[i].abs }
          raise ArgumentError, 'A espessura do MDF deve permanecer fixa.' if rule[Rules::DIMENSIONS[direction]]['follow']
          part.set_attribute(Geometry::DICTIONARY,'rule',JSON.generate(rule))
        end
        sync_selection;send_to_panel('message'=>'Comportamento da peça atualizado.')
      end
    end
    dialog.add_action_callback('save_library') do |_context, target_id, name|
      handle do
        instance = selected_module(target_id)
        Library.save(Sketchup.active_model, instance, name)
        send_to_panel('library' => Library.list, 'message' => 'Modelo completo salvo na biblioteca, incluindo as peças avulsas.')
      end
    end
    dialog.add_action_callback('rename_library') do |_context, id, name|
      handle do
        Library.rename_model(id, name)
        send_to_panel('library' => Library.list, 'message' => 'Nome do modelo salvo atualizado.')
      end
    end
    dialog.add_action_callback('delete_library') do |_context, id|
      handle do
        token = Library.delete_model(id)
        send_to_panel('library' => Library.list, 'library_deleted' => { 'token' => token, 'id' => id })
      end
    end
    dialog.add_action_callback('restore_library') do |_context, token|
      handle do
        Library.restore_model(token)
        send_to_panel('library' => Library.list, 'message' => 'Exclusão desfeita.')
      end
    end
    dialog.add_action_callback('replace_module_material') do |_context, target_id, group_key, part_ids, catalog_id|
      handle do
        model = Sketchup.active_model
        instance = selected_module(target_id)
        Finishing.replace_module_material(model, instance, group_key, part_ids, catalog_id, @scale_watcher)
        send_instance(instance, 'Material das peças deste grupo atualizado. Ctrl+Z desfaz.')
        MaterialCatalog.invalidate_used(model)
        send_to_panel('catalog_used' => MaterialCatalog.used_ids(model))
      end
    end
    dialog.add_action_callback('insert_library') do |_context, id, snapshot|
      handle do
        place_library(id, snapshot)
      end
    end
    dialog.add_action_callback('insert_standalone_baseboard') do |_context, raw, snapshot|
      handle do
        params = Parameters.normalize(raw)
        raise ArgumentError, 'A configuração não é de um rodapé avulso.' unless params['module_family'] == 'baseboard'
        place(params, nil, snapshot)
      end
    end
    dialog.add_action_callback('open_central') do |_context, scope|
      handle do
        id = nil
        unless scope == 'saved'
          raise ArgumentError, 'Carregue as peças desta origem antes de abrir o plano.' unless scope == @production_scope
          validate_production!
          id = Central.capture(@production_model, scope, production_for_cut!)
        end
        send_to_panel('message' => 'Abrindo a Central Plany…')
        open_central_job(id)
      end
    end
    dialog.add_action_callback('central_setup') do |_context, action|
      handle do
        case action
        when 'runtime'
          open_central_job(@central_pending_job, install_runtime: true)
        when 'browser'
          Central.open_install_browser
          send_to_panel('central_setup' => {'step' => 'app'}, 'message' => 'No Edge, instale a Central Plany como app. Depois clique em Verificar vínculo.')
        when 'verify'
          open_central_job(@central_pending_job)
        else
          raise ArgumentError, 'Ação de instalação inválida.'
        end
      end
    end
    dialog.add_action_callback('read_production') do |_context, scope|
      handle do
        raise ArgumentError, 'Escopo inválido.' unless %w[selection all].include?(scope)
        @production_scope = scope
        @production_model = Sketchup.active_model
        @production = Production.collect(@production_model, scope)
        @production_context = {'token'=>SecureRandom.hex(16), 'revision'=>@operation_contract&.revision, 'model_generation'=>@operation_contract&.model_generation, 'generation'=>@operation_contract&.generation, 'scope'=>scope}
        @production_partial, @cut_plan, @cut_search, @search_token = nil, nil, nil, nil
        send_to_panel('production' => @production, 'production_context'=>@production_context, 'message' => 'Coleta concluída. Confira as peças e eventuais pendências antes de preparar o plano.')
      end
    end
    dialog.add_action_callback('accept_partial_production') do |_context, token|
      handle do
        validate_production!
        raise ArgumentError, 'A coleta mudou. Atualize as peças antes de confirmar.' unless @production_context && @production_context['token']==token
        @production_partial=Production.partial_snapshot(@production, token)
        @cut_plan=nil
        send_to_panel('production_partial'=>@production_partial, 'message'=>Production::PARTIAL_WARNING)
      end
    end
    dialog.add_action_callback('revoke_partial_production') do |_context, token|
      handle do
        raise ArgumentError, 'Esta confirmação pertence a outra coleta.' unless @production_context && @production_context['token']==token
        @production_partial, @cut_plan, @search_token=nil,nil,nil
        send_to_panel('production_partial'=>nil, 'production_collection_id'=>token, 'message'=>'Plano parcial revogado. Revise as pendências ou atualize a coleta.')
      end
    end
    dialog.add_action_callback('locate_production_issue') do |_context, token, occurrence|
      handle do
        validate_production!
        raise ArgumentError, 'Esta pendência pertence a outra coleta.' unless @production_context && @production_context['token']==token && Array(@production['issue_details']).any? { |item| item['occurrence_id']==occurrence }
        path=Graph.resolve(@production_model,occurrence)
        raise ArgumentError, 'A ocorrência mudou. Atualize a coleta.' unless path && !path.empty? && path.all? { |part| part.valid? && !part.locked? }
        @production_model.active_path=path.length>1 ? path[0...-1] : nil
        @production_model.selection.clear;@production_model.selection.add(path.last)
        @production_model.active_view.zoom(@production_model.selection)
        sync_selection
        send_to_panel('message'=>'Peça localizada. Confira grupos internos, faces/arestas, forma e solidez no SketchUp. Depois atualize a coleta; nenhuma correção automática foi feita.')
      end
    end
    dialog.add_action_callback('optimize_cut') do |_context, settings, overrides|
      handle do
        validate_production!
        production_for_cut!
        rows = Production.apply_overrides(@production['rows'], overrides)
        @cut_plan = nil
        @cut_search = Cutting::Search.new(rows, settings.merge('sheet_maximum'=>StockFormat.maximum))
        Sketchup.active_model.set_attribute(Geometry::DICTIONARY, 'stock_options', JSON.generate(@cut_search.settings)) unless @production_partial
        run_cut_search
      end
    end
    dialog.add_action_callback('improve_cut') do |_context|
      handle do
        validate_production!
        raise ArgumentError, 'Calcule um plano antes de continuar a busca.' unless @cut_search && @cut_plan
        @cut_search.extend_search
        run_cut_search
      end
    end
    dialog.add_action_callback('cancel_cut') do |_context|
      @search_cancelled = true
    end
    dialog.add_action_callback('save_production') do |_context, overrides|
      handle do
        validate_production!
        raise ArgumentError, 'Resolva as pendências da lista antes de gravar.' unless @production['issues'].empty?
        Production.persist_overrides(@production_model, @production['rows'], overrides)
        @production = Production.collect(@production_model, @production_scope)
        @production_context = {'token'=>SecureRandom.hex(16), 'revision'=>@operation_contract&.revision, 'model_generation'=>@operation_contract&.model_generation, 'generation'=>@operation_contract&.generation, 'scope'=>@production_scope}
        @production_partial=nil
        @cut_plan, @cut_search = nil, nil
        send_to_panel('production' => @production, 'production_context'=>@production_context, 'message' => 'Materiais gravados nas peças do modelo. O veio continua sendo definido automaticamente pelo material.')
      end
    end
    dialog.add_action_callback('export_pieces') do |_context, overrides, format|
      handle do
        validate_production!
        production_for_cut!
        raise ArgumentError, 'O formato CorteCloud não registra pendências. Use a Lista Plany ou o plano parcial da Central; o CSV exige coleta sem pendências.' if @production_partial && format=='cortecloud'
        raise ArgumentError, 'Escolha Lista Plany ou CorteCloud.' unless %w[plany cortecloud].include?(format)
        rows = Cutting.normalize_rows(Production.apply_overrides(@production['rows'], overrides))
        project = @production_model.title.to_s.strip
        project = 'Plany' if project.empty?
        project = project.gsub(/[<>:"\/\\|?*\x00-\x1f]/, '-').sub(/[. ]+\z/, '')
        project = 'Plany' if project.empty?
        name = format == 'plany' ? "Lista_de_pecas_#{project}.xlsx" : "#{project}_CorteCloud.csv"
        @piece_export_pending = {'token'=>SecureRandom.hex(16), 'format'=>format, 'filename'=>name,
          'model_id'=>@production_model.object_id, 'production_id'=>@production.object_id}
        @piece_export_pending['partial']=@production_partial
        @piece_export_pending['filename']='PLANO_PARCIAL_'+name if @production_partial
        send_to_panel('piece_export'=>@piece_export_pending.slice('token','format','partial').merge('rows'=>rows, 'catalog'=>MaterialCatalog.lightweight_metadata))
      end
    end
    dialog.add_action_callback('save_piece_export') do |_context, token, encoded|
      handle do
        pending, @piece_export_pending = @piece_export_pending, nil
        raise ArgumentError, 'A exportação mudou. Gere a lista novamente.' unless pending && pending['token'] == token
        unless pending['model_id'] == @production_model&.object_id && pending['production_id'] == @production&.object_id
          raise ArgumentError, 'A lista ou o projeto mudou. Gere a exportação novamente.'
        end
        validate_production!
        production_for_cut!
        raise ArgumentError, 'O arquivo exportado é inválido ou excede 24 MB.' unless encoded.is_a?(String) && encoded.bytesize.between?(1,32*1024*1024)
        content = Base64.strict_decode64(encoded)
        if pending['format'] == 'plany'
          raise ArgumentError, 'A planilha gerada é inválida.' unless content.start_with?("PK\x03\x04".b)
          title, extension = 'Salvar Lista Plany', '.xlsx'
        else
          csv = content.dup.force_encoding('UTF-8')
          valid = csv.valid_encoding? && !csv.start_with?("\uFEFF") && csv.split("\r\n", -1).all? do |line|
            cells = line.split(';', -1)
            cells.length == 10 && cells[0] == '1' && cells[1..2].all? { |n| n.match?(/\A[1-9]\d*\z/) } && !line.match?(/[\r\n]/)
          end
          raise ArgumentError, 'O arquivo CorteCloud gerado é inválido.' unless valid
          title, extension = 'Salvar CorteCloud', '.csv'
        end
        path = UI.savepanel(title, '', pending['filename'])
        if path
          path += extension unless File.extname(path).downcase == extension
          File.binwrite(path, content)
        end
        send_to_panel('message'=>path ? "Arquivo salvo em #{path}" : 'Exportação cancelada.')
      end
    end
    dialog.add_action_callback('export_cut') do |_context|
      handle do
        validate_production!
        production_for_cut!
        raise ArgumentError, 'Calcule um plano completo antes de exportar.' unless @cut_plan && @cut_plan['unplaced'].empty?
        path = UI.savepanel('Salvar plano para abrir no navegador', '', 'Plany-plano-de-corte.html')
        File.write(path, Production.html(@cut_plan), encoding: 'UTF-8') if path
        send_to_panel('message' => path ? "Plano salvo em #{path}. Abra no navegador para imprimir ou salvar em PDF." : 'Exportação cancelada.')
      end
    end
    dialog.add_action_callback('create_volume_component') do |_ctx, kind, raw, ids, linked|
      handle do
        Settings.require_thickness!
        model = Sketchup.active_model
        area = @loose_door_area
        if kind == 'door'
          raise ArgumentError, 'Selecione os vãos neste projeto.' unless area && area['model'] == model && area['paths'].all? { |path| path.all? { |e| e.valid? && !e.locked? } }
        end
        path = Volume.create(model, kind, raw, ids, linked == true, area)
        @loose_door_area = nil
        @plany_focus_id = Graph.key(path)
        stop_opening_tool
        send_to_panel('component_created'=>true, 'message'=>'Componente criado. Edite em Peças e materiais. Ctrl+Z desfaz.')
        sync_selection
      end
    end
    dialog.add_action_callback('insert_independent_component') do |_ctx, kind, raw|
      handle do
        Settings.require_thickness!
        params = Volume.recipe(kind, raw)
        send_to_panel('component_created'=>true)
        place(params, nil, nil)
      end
    end
    @panel_close = PanelClosure.new(self, @dialog, document)
    dialog.set_on_closed(&@panel_close.method(:call))
    dialog.__getobj__
  end

  def self.panel_closed(dialog)
    return unless @dialog.equal?(dialog)
    cancel_lifecycle_timers(@operation_contract)
    @operation_contract.close if @operation_contract
    Central.dispose if Central.respond_to?(:dispose)
    clear_edge_highlight
    Sketchup.active_model.select_tool(nil) if @painting_tool && @painting_tool.active
    @search_token = @reload_request = nil
    @dialog, @operation_contract, @panel_close, @panel_ready, @pending_payload, @load_selection = nil, nil, nil, false, nil, false
  end

  def self.run_cut_search
    @search_cancelled = false
    @search_token = token = Object.new
    send_to_panel('searching' => true, 'progress' => @cut_search.progress, 'message' => 'Buscando distribuições. Você pode parar e manter o melhor resultado.')
    tick = nil
    tick = operation_callback do
      next unless @search_token.equal?(token)
      begin
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 0.07
        until @cut_search.done? || @search_cancelled
          @cut_search.step
          break if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        end
        if @cut_search.done? || @search_cancelled
          validate_production!
          @cut_plan = @cut_search.plan
          @cut_plan['partial']=Marshal.load(Marshal.dump(@production_partial)) if @production_partial
          @search_token = nil
          message = @cut_plan['unplaced'].empty? ? 'Melhor resultado encontrado. Mais busca mantém ou melhora este plano.' : 'Plano incompleto: confira as peças pendentes e as dimensões disponíveis.'
          send_to_panel('cut_plan' => @cut_plan, 'message' => message)
        else
          send_to_panel('searching' => true, 'progress' => @cut_search.progress,
            'message' => "Busca: #{@cut_search.completed} tentativas avaliadas…")
          lifecycle_timer(0.02, false, panel: true, &tick)
        end
      rescue StandardError => error
        @search_token, @cut_plan, @cut_search = nil, nil, nil
        send_to_panel('error' => PlanyUiFeedback.user(error))
      end
    end
    lifecycle_timer(0.02, false, panel: true, &tick)
  end

  def self.validate_production!
    raise ArgumentError, 'Carregue as peças do projeto novamente.' unless @production && @production_model == Sketchup.active_model
    current = Production.collect(@production_model, @production_scope)
    unless current == @production && (!@production_context || @production_context['revision']==@operation_contract&.revision && @production_context['model_generation']==@operation_contract&.model_generation && @production_context['generation']==@operation_contract&.generation)
      @production_partial,@cut_plan,@search_token=nil,nil,nil
      send_to_panel('production_stale'=>true)
      raise ArgumentError, 'O projeto, a revisão ou a seleção mudou. Atualize a coleta; a autorização parcial anterior foi revogada.'
    end
  end
  def self.production_for_cut!
    data=@production_partial ? @production.merge('partial'=>@production_partial) : @production
    Production.validate_partial!(data)
    data
  end

end

module RQMyDina
  module ObserverLifecycle
    def bind_lifecycle(runtime, model = nil)
      @runtime, @model = runtime, model
      @generation = runtime && runtime.instance_variable_get(:@operation_generation)
      @disposed = false
    end
    def active?
      !@disposed && (!@runtime || @runtime.instance_variable_get(:@operation_generation).equal?(@generation))
    end
    def dispose
      @disposed = true
      @runtime = @model = @watcher = nil
    end
  end
  class SelectionEvents < (defined?(Sketchup::SelectionObserver) ? Sketchup::SelectionObserver : Object)
    include ObserverLifecycle
    def initialize(runtime); bind_lifecycle(runtime); end
    def changed; return unless active?; @runtime.clear_plany_focus; @runtime.queue_selection; end
    def onSelectionBulkChange(_s); changed; end
    def onSelectionCleared(_s); changed; end
    def onSelectionAdded(*_args); changed; end
    def onSelectionRemoved(*_args); changed; end
  end
  class ModelEvents < (defined?(Sketchup::ModelObserver) ? Sketchup::ModelObserver : Object)
    include ObserverLifecycle
    def initialize(runtime, watcher); bind_lifecycle(runtime); @watcher = watcher; end
    def onTransactionCommit(m)
      return unless active?
      @runtime.operation_model_changed
      if Geometry.internal_edit? && @watcher.internal_roots
        MaterialCatalog.invalidate_targets(m, @watcher.internal_roots)
      else
        MaterialCatalog.invalidate_used(m)
      end
      @watcher.changed
    end
    def onTransactionUndo(m); return unless active?; @runtime.operation_model_changed; MaterialCatalog.invalidate_used(m); @watcher.restored; @runtime.refresh_front_command; @runtime.queue_selection; end
    def onTransactionRedo(m); return unless active?; @runtime.operation_model_changed; MaterialCatalog.invalidate_used(m); @watcher.restored; @runtime.refresh_front_command; @runtime.queue_selection; end
    def onTransactionAbort(m); return unless active?; @runtime.operation_model_changed; MaterialCatalog.invalidate_used(m); @watcher.restored; @runtime.queue_selection; end
    def onPreSaveModel(_m); @watcher.flush if active?; end
    def onActivePathChanged(_m); return unless active?; @watcher.changed; @runtime.queue_selection; end
  end
  class AppEvents < (defined?(Sketchup::AppObserver) ? Sketchup::AppObserver : Object)
    include ObserverLifecycle
    def initialize(runtime); bind_lifecycle(runtime); end
    def replaced
      return unless active?
      runtime = @runtime
      runtime.operation_model_replaced
      return unless runtime.authorized?
      runtime.attach_observers
      runtime.queue_selection
    end
    def onNewModel(_m); replaced; end
    def onOpenModel(_m); replaced; end
    def onActivateModel(_m); replaced unless @runtime && @runtime.instance_variable_get(:@observed_model).equal?(Sketchup.active_model); end
    def onQuit; @runtime.close_for_reload if active?; end
  end
  class MaterialsEvents < (defined?(Sketchup::MaterialsObserver) ? Sketchup::MaterialsObserver : Object)
    include ObserverLifecycle
    def initialize(model, watcher, runtime = nil); bind_lifecycle(runtime, model); @watcher = watcher; end
    def onMaterialRefChange(_materials, _material)
      return unless active?
      if Geometry.internal_edit? && @watcher.internal_roots
        MaterialCatalog.invalidate_targets(@model, @watcher.internal_roots)
      else
        MaterialCatalog.invalidate_used(@model)
      end
    end
    def onMaterialAdd(*_args); MaterialCatalog.invalidate_used(@model) if active?; end
    def onMaterialRemove(*_args); MaterialCatalog.invalidate_used(@model) if active?; end
    def onMaterialChange(*_args); MaterialCatalog.invalidate_used(@model) if active?; end
    def onMaterialUndoRedo(*_args); MaterialCatalog.invalidate_used(@model) if active?; end
  end
  def self.operation_model_changed
    @operation_contract.changed if @operation_contract
    @opening_revision = (@opening_revision || 0) + 1
  end

  def self.opening_cache_key
    [Sketchup.active_model.object_id, @document_epoch || 0, @opening_revision || 0]
  end

  def self.operation_model_replaced
    @operation_generation = nil
    cancel_lifecycle_timers
    Central.dispose if Central.respond_to?(:dispose)
    stop_generation_tools
    @operation_generation = Object.new
    @placing = @editing = false
    @active_tool = nil
    @operation_contract.model_replaced if @operation_contract
    @document_epoch = (@document_epoch || 0) + 1
    MaterialCatalog.invalidate_document
    @scale_watcher.cancel if @scale_watcher
    @pending_payload = @reload_state = @command_insert_payload = @target_model = nil
  end

  def self.operation_callback(&block)
    generation = @operation_generation
    callback = @operation_contract ? @operation_contract.callback(&block) : block
    proc do |*args|
      next unless generation && @operation_generation.equal?(generation)
      if authorized?
        callback.call(*args)
      else
        send_to_panel('error'=>'Confirme o acesso de teste para continuar usando o Plany.')
      end
    end
  end

  def self.stop_opening_tool(expected_session = nil)
    return false if expected_session && expected_session != @opening_session
    tool = @opening_tool
    # @opening_tool is cleared on deactivation. Never pop another tool.
    model = Sketchup.active_model
    model.select_tool(nil) if tool && model.tools.active_tool.equal?(tool)
    @opening_tool = nil if @opening_tool.equal?(tool)
    clear_opening_selection
    send_to_panel('opening_tool'=>nil)
  end

  def self.detach_observers
    @selection_queue = nil
    begin
      @scale_watcher.flush if @scale_watcher
    rescue StandardError => error
      warn "[Plany] Encerramento da reconciliação: #{error.message}"
    ensure
      begin
        @scale_watcher.dispose if @scale_watcher
      rescue StandardError => error
        warn "[Plany] Watcher antigo desativado: #{error.message}"
      end
    end
    bindings = []
    if @observed_model && @observed_model.valid?
      bindings = [[@observed_model.selection, @selection_events], [@observed_model, @model_events], [@observed_model.materials, @materials_events]]
    end
    bindings << [Sketchup, @app_events]
    [@selection_events, @model_events, @materials_events, @app_events].compact.each(&:dispose)
    bindings.each do |owner, observer|
      next unless observer
      begin
        owner.remove_observer(observer)
      rescue StandardError => error
        warn "[Plany] Observer antigo desativado: #{error.message}"
      end
    end
    @observed_model = @app_events = @selection_events = @model_events = @materials_events = @scale_watcher = nil
  end
  def self.attach_observers
    require_access!
    model = Sketchup.active_model
    return if @observed_model == model && @observed_document_epoch == (@document_epoch || 0)
    detach_observers
    begin
      recovered_tapes = Finishing.recover_painted_edges(model)
      puts "[Plany] Fitas recuperadas em #{recovered_tapes} ficha(s) salva(s). Ctrl+Z desfaz." if recovered_tapes > 0
      recovery = Finishing.recover_painted_mdf(model)
      recovered = recovery['recovered']
      conflicts = recovery['conflicts'].length
      if recovered > 0 || conflicts > 0
        @mdf_recovery_notice = "MDF recuperado em #{recovered} peça(s). Ctrl+Z desfaz a recuperação."
        @mdf_recovery_notice += " #{conflicts} peça(s) com cores conflitantes, bloqueio ou material pendente: escolha o MDF correto antes de enviar à Central." if conflicts > 0
        puts "[Plany] #{@mdf_recovery_notice}"
        recovery['conflicts'].each { |item| warn "[Plany] MDF #{item['name']}: #{item['reason']}" }
      end
    rescue StandardError => error
      @mdf_recovery_notice = 'A recuperação dos acabamentos antigos não terminou. Confira o MDF das peças antes de enviar à Central.'
      warn "[Plany] Recuperação dos acabamentos antigos: #{error.message}"
    end
    Geometry.migrate_cut_orientations(model)
    repaired_shelves = Geometry.repair_rail_limited_shelves(model)
    puts "[Plany] #{repaired_shelves} prateleira(s) com profundidade recuperada. Ctrl+Z desfaz." if repaired_shelves > 0
    Appearance.refresh_scale_masks(model)
    Hardware.refresh_door_limits(model)
    @observed_model = model
    @observed_document_epoch = @document_epoch || 0
    @scale_watcher = ScaleWatcher.new(model, proc do |error|
      Sketchup.set_status_text(error) if error
      queue_selection
      payload = {'native_edit_error' => !!error}
      payload['error'] = error if error
      send_to_panel(payload)
    end)
    @selection_events = SelectionEvents.new(self)
    @model_events = ModelEvents.new(self, @scale_watcher)
    @materials_events = MaterialsEvents.new(model, @scale_watcher, self)
    @app_events = AppEvents.new(self)
    model.selection.add_observer(@selection_events)
    model.add_observer(@model_events)
    model.materials.add_observer(@materials_events)
    Sketchup.add_observer(@app_events)
    @scale_watcher.changed
  rescue StandardError
    detach_observers
    raise
  end
  def self.queue_selection
    return unless @dialog && @panel_ready
    @selection_queue = token = Object.new
    lifecycle_timer(0.04, false, panel: true) { sync_selection if @selection_queue.equal?(token) }
  end
  def self.piece_list_context(model, list_id)
    if list_id == 'root'
      {'id'=>list_id, 'title'=>'Peças avulsas do projeto', 'scope_name'=>model.title.to_s.empty? ? 'Projeto sem nome' : model.title.to_s}
    else
      group = Graph.resolve(model, list_id).last
      name = group.name.to_s.empty? ? 'Grupo sem nome' : group.name.to_s
      {'id'=>list_id, 'title'=>'Peças avulsas do grupo', 'scope_name'=>name}
    end
  end

  def self.piece_navigation(model, path)
    owner_index = path.rindex { |part| Geometry.module?(part) }
    if owner_index
      {'label'=>'Ver peças do módulo', 'title'=>'Peças do módulo', 'scope_name'=>Geometry.read(path[owner_index])['name']}
    else
      list_id = @plany_piece_return_id || (path.length > 1 ? Graph.key(path[0...-1]) : 'root')
      context = piece_list_context(model, list_id)
      context.merge('label'=>(@plany_piece_return_id ? '← Voltar para ' : 'Ver ') + context['title'].downcase)
    end
  end

  def self.sync_selection(evidence = {})
    return if @editing || @placing
    model = Sketchup.active_model
    @target_model = model
    if @plany_piece_list_id
      prefix = @plany_piece_list_id == 'root' ? [] : Graph.resolve(model, @plany_piece_list_id)
      paths = Graph.boards(prefix.empty? ? model.entities : prefix.last.definition.entities).map { |path| prefix + path }
      send_to_panel({'selection_event'=>true, 'selection_key'=>"piece-list:#{@plany_piece_list_id}",
        'selection_kind'=>'piece_group', 'piece_list_context'=>piece_list_context(model, @plany_piece_list_id),
        'piece_list'=>paths.map { |path| { 'path'=>Graph.key(path), 'name'=>path.last.name } }}.merge(evidence))
      return
    end
    paths = focused_paths(model)
    modules = paths.select { |p| Geometry.module?(p.last) }
    module_params = {}
    clear_edge_highlight
    pieces = paths.select { |p| Graph.registered?(p.last) }
    payload = { 'selection_event' => true, 'selection_key' => model.object_id.to_s + ':' + paths.map { |p| Graph.key(p) }.join(','),
      'selection_kind' => 'empty', 'target_id' => nil, 'extras' => [],
      'module_descriptor'=>nil, 'module_children'=>[], 'module_inventory'=>nil,
      'catalog_used' => MaterialCatalog.used_ids(model),
      'materials' => model.materials.map(&:display_name).reject { |n| n == 'Plany · MDF cru' || n.to_s.strip.casecmp('MDF').zero? || n.to_s.start_with?('Vidro ') } }
    payload['registration_count']=model.selection.count { |e| Geometry.part?(e) && !Geometry.module?(e) && !Graph.registered?(e) }
    selected = model.selection.to_a
    if selected.length==1 && Geometry.part?(selected.first) && !Geometry.module?(selected.first) && !modules.empty?
      container_path=(model.active_path || [])+[selected.first]
      payload['container_target_id']=Graph.key(container_path)
      payload.merge!(module_context(container_path))
    end
    payload['can_register'] = payload['registration_count'] > 0 && selected.all? { |e| Geometry.part?(e) && !Geometry.module?(e) }
    payload['include_count'] = selected.count { |e| Geometry.module?(e) } == 1 ? selected.count { |e| Geometry.part?(e) && !Geometry.module?(e) } : 0
    if paths.length == 1 && modules.length == 1
      path = modules.first
      payload.merge!('selection_kind' => 'module', 'target_id' => Graph.key(path),
        'params' => (module_params[path.last] ||= Geometry.read(path.last)), 'extras' => Geometry.extra_data(path.last, path),
        'composite_root_id' => @composite_root_id,
        'module_materials' => Finishing.module_mdf_materials(path.last), 'elevation' => Finishing.elevation(path),
        'piece_elevations' => Finishing.piece_elevations(path))
      payload.merge!(module_context(path))
    elsif modules.length > 1 && pieces.empty?
      values = { 'material' => [], 'front_material' => [], 'front_thickness' => [] }
      modules.each do |path|
        params = module_params[path.last] ||= Geometry.read(path.last)
        panels = Parameters.panels(params)
        values['material'] << params['material']
        panels.each do |piece|
          if Workshop.front_role?(piece['role'])
            values['front_material'] << piece['material']
            values['front_thickness'] << piece['size'][piece['thickness_axis']]
          elsif piece['role'] != 'back'
            values['material'] << piece['material']
          end
        end
      end
      payload.merge!('selection_kind' => 'bulk', 'targets' => modules.map { |p| Graph.key(p) },
        'common' => values.transform_values { |v| v.uniq.length == 1 ? v.first : nil })
    elsif !pieces.empty? && modules.empty?
      payload.merge!('selection_kind' => pieces.length == 1 ? 'piece' : 'pieces', 'pieces' => pieces.map do |path|
        part = path.last
        { 'id' => part.persistent_id.to_s, 'path' => Graph.key(path), 'name' => part.name, 'can_detach' => path.length > 1,
          'navigation' => piece_navigation(model, path),
          'size' => Geometry.physical_size(part, Graph.transform(path)), 'axis' => Finishing.axis(part),
          'elevation' => Finishing.elevation(path),
          'module_owned' => path[0...-1].any? { |entity| Geometry.module?(entity) },
          'material' => part.material ? MaterialCatalog.canonical_name(part.material) : MaterialCatalog.canonical_name(part.get_attribute(Geometry::DICTIONARY,'cut_material','Branco TX')),
          'color' => part.material ? MaterialCatalog.color_hex(part.material) : nil,
          'settings' => Geometry.piece_data(part) }
      end)
    elsif !modules.empty? && !pieces.empty?
      payload['selection_kind'] = 'mixed'
    end
    if paths.length > 1
      payload['targets'] = paths.map { |p| Graph.key(p) }
      payload['module_count'] = modules.length
      payload['piece_count'] = pieces.length
      values = pieces.map { |p| Geometry.piece_data(p.last)['material'] || p.last.get_attribute(Geometry::DICTIONARY, 'cut_material', 'Branco TX') }
      values.concat(modules.map { |p| (module_params[p.last] ||= Geometry.read(p.last))['material'] })
      payload['common'] ||= {}
      payload['common']['material'] = values.uniq.length == 1 ? values.first : nil
      if modules.empty?
        thicknesses = pieces.map { |p| Geometry.physical_size(p.last, Graph.transform(p))[Finishing.axis(p.last)] }
        payload['common']['thickness'] = thicknesses.uniq.length == 1 ? thicknesses.first : nil
      end
    end
    selected_boards = Finishing.boards(model)
    payload['front_state'] = Finishing.front_state(model, selected_boards)
    payload['has_fronts'] = payload['front_state']['count'] > 0
    combine = Workshop.combine_scope(model)
    payload['can_combine'] = combine[:allowed]
    payload['combine_unavailable_reason'] = combine[:reason]
    payload['module_count'] = modules.length
    if paths.length > 1
      data = selected_boards.map { |p| Geometry.piece_data(p.last) }
      payload['common'] ||= {}
      grains = data.map { |d| d['grain'] }.uniq
      payload['common']['grain'] = grains.length == 1 ? grains.first : nil
      payload['common']['edges'] = %w[u_min u_max v_min v_max].to_h do |edge|
        values = data.map { |d| d.fetch('edges',[]).include?(edge) }.uniq
        [edge, values.length == 1 ? values.first : nil]
      end
    end
    unless @plany_focus_id && payload['selection_kind'] == 'piece'
      volume_paths = Volume.selection(model)
      volume_paths = modules if @plany_focus_id && modules.length == 1
      unless volume_paths.empty?
        payload['volume'] = Volume.payload(model, volume_paths)
        payload['targets'] ||= paths.map { |path| Graph.key(path) }
        payload['selection_key'] += ':volume:' + volume_paths.map { |path| Graph.key(path) }.join(',')
        unless payload['selection_kind'] == 'module' && volume_paths.length == 1 && Graph.key(volume_paths.first) == payload['target_id'].to_s
          payload['selection_kind'] = 'volume' unless payload['selection_kind'] == 'bulk'
        end
      end
    end
    openings = opening_payloads(payload)
    payload['selection_capabilities'] = {
      'general'=>!paths.empty? || !!payload['volume'], 'materials'=>!paths.empty?,
      'navigation'=>%w[bulk pieces mixed volume].include?(payload['selection_kind']),
      'pieces'=>!selected_boards.empty?, 'insertions'=>!!payload['volume'],
      'combine'=>combine[:allowed],
      'insertion_reason'=>payload['volume'] ? nil : 'Esta seleção não define um volume único. Selecione um módulo ou grupo para inserir componentes.'
    }
    payload['selection_pieces'] = selected_boards.map do |path|
      {'path'=>Graph.key(path), 'name'=>path.last.name}
    end
    payload['openings'] = openings
    payload['opening'] = openings.first
    payload['plany_focus'] = @plany_focus_request if @plany_focus_request
    payload['selection_return'] = !!@plany_selection_return
    @plany_focus_request = nil
    send_to_panel(payload.merge(evidence))
  rescue StandardError => error
    send_to_panel('selection_kind' => 'empty', 'selection_event' => true, 'error' => PlanyUiFeedback.user(error))
  end
  def self.editor_piece_path(id, role)
    model = Sketchup.active_model
    focused = focused_paths(model).find { |path| Graph.key(path) == id }
    raise ArgumentError, 'A seleção mudou. Selecione a peça novamente.' unless focused
    return focused if role.to_s.empty? && Graph.registered?(focused.last)
    raise ArgumentError, 'Selecione o módulo desta peça.' unless Geometry.module?(focused.last)
    relative = Graph.boards(focused.last.definition.entities).find do |path|
      role.to_s.start_with?('extra:') ? Graph.key(path) == role.to_s.delete_prefix('extra:') : path.last.get_attribute(Geometry::DICTIONARY, 'role') == role
    end
    raise ArgumentError, 'A peça mudou. Selecione-a novamente.' unless relative
    focused + relative
  end

  def self.register_workshop_callbacks(dialog)
    dialog.add_action_callback('open_piece') do |_ctx, id|
      handle do
        path = Graph.resolve(Sketchup.active_model, id)
        raise ArgumentError, 'A peça mudou.' unless Graph.registered?(path.last)
        origin_list_id = @plany_piece_list_id
        origin_selection = !origin_list_id && focused_paths(Sketchup.active_model).length>1 ? native_selection_key(Sketchup.active_model) : nil
        clear_plany_focus
        @plany_selection_return = origin_selection
        open_plany_piece(path, false, origin_list_id)
        send_to_panel('message' => 'Peça aberta para edição.')
      end
    end
    dialog.add_action_callback('back_to_selection') do |_ctx|
      handle do
        raise ArgumentError, 'A seleção de origem mudou. Selecione os itens novamente.' unless @plany_selection_return == native_selection_key(Sketchup.active_model)
        clear_plany_focus
        sync_selection
      end
    end
    dialog.add_action_callback('back_to_pieces') do |_ctx, id, role|
      handle do
        path = editor_piece_path(id, role)
        owner_index = path.rindex { |part| Geometry.module?(part) }
        origin_list_id = @plany_piece_return_id
        clear_plany_focus
        if owner_index
          @plany_focus_id = Graph.key(path[0..owner_index])
          @plany_focus_request = { 'pieces' => true }
        else
          @plany_piece_list_id = origin_list_id || (path.length > 1 ? Graph.key(path[0...-1]) : 'root')
        end
        sync_selection
        send_to_panel('message' => owner_index ? 'Peças do módulo abertas.' : piece_list_context(Sketchup.active_model, @plany_piece_list_id)['title'] + '.')
      end
    end
    %w[delete_piece detach_piece].each do |action|
      dialog.add_action_callback(action) do |_ctx, id, role|
        handle do
          clear_edge_highlight
          model = Sketchup.active_model
          path = editor_piece_path(id, role)
          piece_name = path.last.name.to_s
          result = Workshop.remove_piece(model, path, detach: action == 'detach_piece')
          clear_plany_focus
          if result['piece']
            @plany_focus_id = Graph.key([result['piece']])
            @plany_focus_request = { 'solo' => true }
          elsif result['owner_path']
            @plany_focus_id = Graph.key(result['owner_path'])
            @plany_focus_request = { 'pieces' => true }
          else
            parent = result['parent_path']
            @plany_piece_list_id = parent.empty? ? 'root' : Graph.key(parent)
          end
          @scale_watcher.snapshot
          evidence = result['piece'] ? {} : {'piece_removed'=>{'target_id'=>id,'role'=>role,'path'=>result['removed_path'],'name'=>piece_name}}
          sync_selection(evidence)
          send_to_panel('message' => result['piece'] ? 'Peça avulsa na raiz do modelo. Ctrl+Z desfaz.' : "#{piece_name.empty? ? 'Peça' : piece_name} removida. Ctrl+Z desfaz.")
        end
      end
    end
    dialog.add_action_callback('detach_panel_units') do |_ctx,id|
      handle do
        model=Sketchup.active_model;path=Graph.resolve(model,id)
        raise ArgumentError, 'Saia da edição dos grupos para desassociar os painéis.' unless path.length==1
        Geometry.detach_panel_units(model,path.last)
        @plany_focus_id=nil;@scale_watcher.snapshot;sync_selection
        send_to_panel('message'=>'Painéis desassociados em módulos independentes. Ctrl+Z desfaz.')
      end
    end
    dialog.add_action_callback('highlight_edge') do |_ctx, ids, edge, role|
      begin
        highlight_edge(ids, edge, role)
      rescue StandardError => error
        clear_edge_highlight
        warn "[Plany] Realce de borda: #{error.message}"
      end
    end
    dialog.add_action_callback('focus_carcass') do |_ctx, id, focus|
      handle do
        model = Sketchup.active_model
        current = focused_paths(model)
        selected=model.selection.to_a
        root_id = @composite_root_id
        unless root_id
          root_id=if current.length==1 && Geometry.module?(current.first.last)
            Graph.key(current.first)
          elsif selected.length==1 && Geometry.part?(selected.first) && !Geometry.module?(selected.first)
            Graph.key((model.active_path || [])+[selected.first])
          end
        end
        raise ArgumentError, 'Selecione um conjunto ou grupo com módulos.' unless root_id
        root = Graph.resolve(model, root_id)
        allowed = [root_id] + Geometry.module_children(root).map { |item| item['target_id'] }
        raise ArgumentError, 'O módulo não pertence a este conjunto.' unless allowed.include?(id.to_s)
        if id.to_s==root_id
          clear_plany_focus
          @plany_focus_id=root_id unless Graph.selection(model).any? { |path| Graph.key(path)==root_id }
        else
          @composite_root_id=root_id
          @plany_focus_id=id.to_s
        end
        @plany_focus_request = focus.is_a?(Hash) ? focus : {'insertion'=>['carcass']}
        sync_selection
      end
    end
    dialog.add_action_callback('combine_selection') do |_ctx, ids, confirmed|
      handle { clear_edge_highlight; result=Workshop.combine(Sketchup.active_model, ids, confirmed); clear_plany_focus; send_instance(result, 'Peças reunidas no módulo. Ctrl+Z desfaz.'); sync_selection }
    end
    dialog.add_action_callback('select_openings') do |_ctx, action = nil, loose = false, scope = nil, envelope = false|
      action = action.to_s
      action = nil if action.empty?
      select_openings(action, loose == true, scope, envelope == true)
      if action
        label = OpeningSelectionTool::ACTION_LABELS[action] || 'Ferramenta'
        send_to_panel('opening_tool'=>action, 'message'=>"#{label}: configuração aberta. Clique em um ou mais vãos no SketchUp e conclua no Plany.")
      else
        send_to_panel('message'=>'Clique em um vão. Ctrl adiciona, Shift alterna e Ctrl+Shift remove.')
      end
    end
    dialog.add_action_callback('clear_opening') do |_ctx, expected_session|
      stop_opening_tool(expected_session)
      send_to_panel('message'=>'Módulo selecionado.')
    end
    dialog.add_action_callback('bulk_update') do |_ctx, ids, changes|
      handle { Finishing.bulk(Sketchup.active_model, ids, changes, @scale_watcher); sync_selection; send_to_panel('message' => 'Configurações aplicadas à seleção. Ctrl+Z desfaz o conjunto.') }
    end
    dialog.add_action_callback('register_pieces') do |_ctx|
      handle do
        model = Sketchup.active_model
        selected = model.selection.to_a
        raise ArgumentError, 'Selecione chapas agrupadas ou componentes retangulares.' if selected.empty? || selected.any? { |e| !Geometry.part?(e) || Geometry.module?(e) }
        selected.each { |e| Appearance.box!(e); raise ArgumentError, 'Desbloqueie as peças.' if e.locked? }
        Geometry.validate_owners!([(model.active_path || []) + selected])
        Geometry.transaction(model, 'Plany: cadastrar peças') do
          paths = Graph.unique_paths(selected.map { |part| (model.active_path || []) + [part] })
          registered = paths.map { |path| Appearance.register(path.last) }
          model.selection.clear; model.selection.add(registered)
        end
        sync_selection
        send_to_panel('message' => 'Chapas cadastradas. Agora entram na lista de peças do Plany.')
      end
    end
    dialog.add_action_callback('assemble_selection') do |_ctx, name, entries|
        handle { send_instance(Workshop.assemble(Sketchup.active_model, name, entries), 'Módulo criado. Salve em Meus Modelos para configurar o comportamento das peças avulsas.') }
    end
    dialog.add_action_callback('update_piece') do |_ctx, id, raw|
      handle do
        model = Sketchup.active_model
        paths = focused_paths(model)
        raise ArgumentError, 'A seleção mudou.' unless paths.length == 1 && Graph.key(paths.first) == id && Graph.registered?(paths.first.last)
        data = Parameters.normalize_piece(raw['settings'])
        previous = Geometry.piece_data(paths.first.last)
        data['material'] = MaterialCatalog.canonical_name(data['material']) if data['material'] && data.fetch('construction_type', 'mdf') == 'mdf'
        if data.fetch('construction_type', 'mdf') == 'mdf' && data['material'] != previous['material']
          raise ArgumentError, 'Material MDF não reconhecido no catálogo.' unless MaterialCatalog.valid_mdf_name?(data['material'])
          data['grain'] = MaterialCatalog.grain_for_material(data['material'])
          raise ArgumentError, 'Este material ainda não possui sentido de veio validado no catálogo.' if data['grain'] == 'unknown'
        end
        if data['material'] != previous['material']
          data['edge_materials'] = Finishing.edge_colors(paths.first.last).merge(data.fetch('edge_materials', {}))
        end
        sizes = raw['size'].map { |v| Parameters.number(v, 'Medida da peça', 3, 4000) }
        elevation = Parameters.number(raw['elevation'], 'Elevação', -100000, 100000) unless raw['elevation'].nil?
        if !elevation.nil? && paths.first[0...-1].any? { |entity| Geometry.module?(entity) }
          raise ArgumentError, 'A elevação absoluta pertence ao módulo.'
        end
        axis = Finishing.axis(paths.first.last)
        data['thickness'] = Parameters.number(sizes[axis], 'Espessura do MDF', 3, 40)
        # The form carries physical millimetres, already including occurrence scale.
        data = Geometry.validate_piece!(paths.first.last, data, sizes)
        path = nil
        Geometry.transaction(model, 'Plany: ajustar peça') do
          path = Graph.unique(paths.first); part = path.last
          data = Geometry.resize_board!(path, sizes, data)
          part.name = raw['name'].to_s[0,60]
          Finishing.persist_piece_material(path, data)
          Finishing.set_elevation(path, elevation) unless elevation.nil?
          owner = path.reverse.find { |e| Geometry.module?(e) }
          if owner && part.get_attribute(Geometry::DICTIONARY, 'role')
            @scale_watcher.record_piece_adjustment(path)
          elsif owner
            Geometry.store(owner, Geometry.read(owner))
          end
          Finishing.show_textures(model)
        end
        @plany_focus_id = Graph.key(path) if @plany_focus_id
        sync_selection
        send_to_panel('message' => 'Peça atualizada. Ctrl+Z desfaz.')
      end
    end
    dialog.add_action_callback('set_piece_edge') do |_ctx, target_id, role, edge, enabled, glass_finish = nil|
      handle do
        raise ArgumentError, 'Borda inválida.' unless %w[u_min u_max v_min v_max].include?(edge) && [true, false].include?(enabled)
        model = Sketchup.active_model
        path = if role.to_s.empty?
          focused_paths(model).find { |candidate| Graph.key(candidate) == target_id && Graph.registered?(candidate.last) }
        else
          owner = selected_module(target_id)
          owner_path = focused_paths(model).find { |candidate| candidate.last == owner }
          found = nil
          Graph.walk(owner.definition.entities, owner_path) do |candidate|
            part = candidate.last
            found = candidate if part.get_attribute(Geometry::DICTIONARY, 'role').to_s == role.to_s ||
              (role.to_s.start_with?('extra:') && Graph.key(candidate.drop(owner_path.length)) == role.to_s.delete_prefix('extra:'))
            found.nil?
          end
          found
        end
        raise ArgumentError, 'A peça mudou. Selecione-a novamente.' unless path && Graph.registered?(path.last)
        glass = Geometry.piece_data(path.last)['construction_type']=='glass'
        if glass
          raise ArgumentError, 'Acabamento do vidro inválido.' unless Glass::FINISHES.include?(glass_finish)
          finishes = Glass.normalize(Geometry.piece_data(path.last))['glass_edge_finishes'].merge(edge=>glass_finish)
          changes = {'glass_edge_finishes'=>finishes}
        else
          raise ArgumentError, 'Acabamento de vidro exige uma peça de vidro.' unless glass_finish.nil?
          changes = {'edge_changes'=>{edge=>enabled}}
        end
        Geometry.transaction(model, glass ? 'Plany: alterar acabamento do vidro' : 'Plany: alterar fita da borda') do
          Finishing.update_piece(Graph.unique(path), changes, @scale_watcher)
          Finishing.show_textures(model)
        end
        send_to_panel('edge_saved' => { 'role' => role, 'edge' => edge, 'enabled' => enabled, 'glass_finish'=>glass_finish },
                      'message' => glass ? 'Acabamento do vidro atualizado. Ctrl+Z desfaz.' : 'Fita atualizada na peça. Ctrl+Z desfaz.')
      end
    end
    dialog.add_action_callback('refresh_finishes') do |_ctx, scope|
      handle do
        raise ArgumentError, 'Escopo inválido.' unless %w[selection all].include?(scope)
        count = Finishing.refresh(Sketchup.active_model, scope)
        sync_selection
        send_to_panel('message' => "Acabamentos atualizados em #{count} peças. Texturas visíveis; Ctrl+Z desfaz.")
      end
    end
    dialog.add_action_callback('toggle_fronts') do |_ctx|
      handle do
        hidden = Finishing.toggle_fronts(Sketchup.active_model)
        sync_selection
        send_to_panel('message' => hidden ? 'Frentes ocultas. Continuam na lista e no plano de corte.' : 'Visibilidade anterior das frentes restaurada.')
      end
    end
    dialog.add_action_callback('list_materials') do |_ctx|
      handle do
        model = Sketchup.active_model
        send_to_panel(
          'catalog' => MaterialCatalog.available(model),
          'material_sources' => MaterialCatalog::SOURCES
        )
      end
    end
    dialog.add_action_callback('open_material_source') do |_ctx, brand|
      handle { UI.openURL(MaterialCatalog::SOURCES.fetch(brand)); send_to_panel('message' => 'Página oficial aberta no navegador.') }
    end
    dialog.add_action_callback('import_materials') do |_ctx, brand|
      handle do
        raise ArgumentError, 'Selecione Duratex, Guararapes, Arauco ou Berneck.' unless MaterialCatalog::REGISTERED_MDF_BRANDS.include?(brand.to_s)
        folder = UI.select_directory(title: 'Pasta com materiais SKM', directory: MaterialCatalog.directory)
        if folder
          files = Dir.glob('**/*', base: folder.tr('\\', '/')).map { |p| File.join(folder, p) }
                     .select { |p| File.file?(p) && File.extname(p).downcase == '.skm' }
          raise ArgumentError, 'Esta pasta não contém materiais .skm. Descompacte o pacote do fabricante primeiro.' if files.empty?
          count = 0; failures = []
          files.each do |path|
            begin
              relative = path.to_s.start_with?(folder.to_s) ? path.to_s[folder.to_s.length..-1].to_s : path.to_s
              relative = relative.tr('\\', '/').sub(%r{\A/+}, '')
              parent = File.dirname(relative)
              line = parent == '.' ? nil : File.basename(parent).to_s.strip
              generic = %w[materiais materials texturas textures skm]
              line = nil if line.to_s.empty? ||
                MaterialCatalog.normalized_name(line) == MaterialCatalog.normalized_name(brand) ||
                generic.include?(MaterialCatalog.normalized_name(line))
              metadata = {}
              metadata['line'] = line if line
              MaterialCatalog.import_package(Sketchup.active_model, path, brand, metadata)
              count += 1
            rescue StandardError
              failures << File.basename(path)
            end
          end
          MaterialCatalog.invalidate_used(Sketchup.active_model)
          send_to_panel('catalog' => MaterialCatalog.available(Sketchup.active_model), 'message' => "#{count} materiais importados." + (failures.empty? ? '' : " Não foi possível abrir: #{failures.join(', ')}"))
        else
          send_to_panel('message' => 'Importação cancelada.')
        end
      end
    end
    dialog.add_action_callback('pick_catalog_material') do |_ctx|
      handle do
        model = Sketchup.active_model
        model.select_tool(nil) if @painting_tool && @painting_tool.active
        model.select_tool(nil) if @material_picker && @material_picker.active
        picked = operation_callback do |material, cancelled|
          @material_picker = nil
          if cancelled
            send_to_panel('material_pick_active' => false, 'message' => 'Captura de material cancelada.')
          elsif material
            entry = MaterialCatalog.recognize(material)
            if entry
              send_to_panel(
                'material_pick_active' => false,
                'picked_material' => {'recognized' => true, 'entry' => entry.merge('value' => MaterialCatalog.model_material_name(entry))},
                'message' => "Material reconhecido: #{entry['name']}."
              )
            else
              preview = MaterialCatalog.preview(material)
              send_to_panel(
                'material_pick_active' => false,
                'picked_material' => preview.merge('recognized' => false),
                'message' => "Material não reconhecido no catálogo: #{material.display_name}."
              )
            end
          end
        end
        @material_picker = MaterialPickerTool.new(model, &picked)
        model.select_tool(@material_picker)
        send_to_panel(
          'material_pick_active' => true,
          'message' => 'Conta-gotas ativo. Clique em uma face do SketchUp para identificar o material; Esc cancela.'
        )
      end
    end
    dialog.add_action_callback('use_catalog_material') do |_ctx, id|
      handle do
        model = Sketchup.active_model
        entry = MaterialCatalog.entry(model, id)
        raise ArgumentError, 'Este campo aceita somente materiais MDF ou a classe Retalho.' unless %w[mdf surplus].include?(entry.fetch('family', 'mdf'))
        raise ArgumentError, 'Este material ainda não possui textura validada para aplicação.' unless MaterialCatalog.render_ready?(entry)
        # Choosing a form value must not mutate the model/revision. Appearance
        # loads the selected texture inside the eventual Apply transaction.
        chosen = entry.merge('value' => MaterialCatalog.model_material_name(entry))
        send_to_panel('chosen_material' => chosen, 'message' => 'Material escolhido. Aplique para atualizar a seleção.')
      end
    end
    dialog.add_action_callback('apply_catalog_selection') do |_ctx, ids, name, target|
      handle do
        model = Sketchup.active_model
        Finishing.apply_material(model, ids, name, @scale_watcher, target || 'all')
        MaterialCatalog.invalidate_used(model)
        sync_selection
        send_to_panel('message' => 'Material aplicado às peças Plany da seleção. Ctrl+Z desfaz.')
      end
    end
    dialog.add_action_callback('apply_catalog_material') do |_ctx, id, ids, target|
      handle do
        raise ArgumentError, 'Destino do material inválido.' unless %w[all body fronts front_edges claddings paint_surface paint_individual paint_category paint_group paint_project compatible].include?(target)
        model = Sketchup.active_model
        clear_edge_highlight
        model.select_tool(nil) if @painting_tool && @painting_tool.active
        entry = MaterialCatalog.entry(model, id)
        family = entry.fetch('family', 'mdf')
        mat = MaterialCatalog.load(model, id)
        material_name = family == 'surplus' ? 'Retalho' : MaterialCatalog.canonical_name(mat)

        if target.start_with?('paint_')
          raise ArgumentError, 'O pincel está disponível apenas para materiais MDF ou Retalho.' unless %w[mdf surplus].include?(family)
          scope = target.delete_prefix('paint_')
          paint_tool = nil
          painted = operation_callback do |surface|
            MaterialCatalog.invalidate_used(model)
            sync_selection
            board_surface = %w[piece face_min face_max].include?(surface)
            message = if surface == 'grain'
              Finishing.grain_result_message(paint_tool.grain_report)
            elsif paint_tool.scope == 'group'
              'Grupo de acabamento atualizado neste módulo.'
            elsif paint_tool.scope == 'project'
              'Cor substituída no projeto.'
            elsif family == 'surplus'
              board_surface ? 'Retalho aplicado à chapa inteira; as fitas foram preservadas.' : 'Retalho aplicado nesta borda.'
            else
              board_surface ? 'MDF alterado na chapa inteira, nos dois lados; as fitas foram preservadas.' : 'Fita MDF aplicada nesta borda.'
            end
            send_to_panel('catalog_used' => MaterialCatalog.used_ids(model),
              'material_grain_result'=>(surface == 'grain' ? paint_tool.grain_report : nil),
              'message' => message + (surface == 'grain' ? ' Continue usando a ferramenta ou pressione Esc.' : ' Continue pintando ou pressione Esc. Ctrl+Z desfaz.'))
          end
          paint_tool = MaterialPaintTool.new(model, material_name, @scale_watcher, 'mdf', scope, &painted)
          paint_tool.on_error = operation_callback do |error|
            send_to_panel('material_grain_error'=>error, 'message'=>error)
          end
          paint_tool.on_end = operation_callback do |closed|
            if @painting_tool.equal?(paint_tool)
              @painting_tool = nil if closed
              send_to_panel('material_paint_active' => !closed, 'material_paint_closed'=>closed,
                'material_paint_tool_active'=>false,
                'message' => closed ? 'Pintura encerrada.' : 'Ferramenta pausada. Escolha uma ação para continuar.')
            end
          end
          @painting_tool = paint_tool
          model.select_tool(paint_tool)
          send_to_panel('material_paint_active' => true, 'material_paint_scope' => scope,
                        'message' => scope == 'surface' ? 'Face: troca o MDF da chapa inteira. Borda: aplica fita nessa cor. Esc encerra.' : family == 'surplus' ? 'Clique em uma peça MDF ou numa borda para aplicar Retalho. Esc encerra a pintura.' : 'Clique em uma peça MDF ou numa borda MDF. Esc encerra a pintura.')
        elsif family == 'glass'
          raise ArgumentError, 'Vidro só pode ser aplicado a peças de vidro.' unless target == 'compatible'
          Finishing.apply_target_material(model, entry['name'], @scale_watcher, 'compatible', 'glass', entry['glass_color'], ids)
          MaterialCatalog.invalidate_targets(model, Graph.selection(model).map(&:first))
          sync_selection
          send_to_panel('catalog_used' => MaterialCatalog.used_ids(model), 'message' => 'Cor de vidro aplicada às peças de vidro compatíveis. Ctrl+Z desfaz.')
        elsif family == 'metal'
          raise ArgumentError, 'Metal só pode ser aplicado a peças metálicas.' unless target == 'compatible'
          Finishing.apply_target_material(model, entry['name'], @scale_watcher, 'compatible', 'metal', nil, ids)
          MaterialCatalog.invalidate_targets(model, Graph.selection(model).map(&:first))
          sync_selection
          send_to_panel('catalog_used' => MaterialCatalog.used_ids(model), 'message' => 'Acabamento metálico aplicado às peças compatíveis. Ctrl+Z desfaz.')
        else
          raise ArgumentError, 'Este destino é exclusivo de MDF.' if target == 'compatible'
          Finishing.apply_target_material(model, material_name, @scale_watcher, target, 'mdf', nil, ids)
          MaterialCatalog.invalidate_targets(model, Graph.selection(model).map(&:first))
          sync_selection
          send_to_panel('catalog_used' => MaterialCatalog.used_ids(model), 'message' => (family == 'surplus' ? 'Retalho aplicada.' : 'Material MDF aplicado.') + ' Ctrl+Z desfaz.')
        end
      end
    end
    dialog.add_action_callback('set_material_paint_scope') do |_ctx, scope|
      handle do
        raise ArgumentError, 'Alcance do pincel inválido.' unless %w[surface individual category group project].include?(scope)
        resume_material_paint
        @painting_tool.scope = scope
        @painting_tool.grain_mode = 'paint'
        send_to_panel('material_paint_active' => true, 'material_paint_scope' => scope,
                      'material_grain_mode'=>'paint',
                      'message' => 'Alcance atualizado. Continue pintando.')
      end
    end
    dialog.add_action_callback('set_material_grain_tool') do |_ctx, raw|
      handle do
        resume_material_paint
        options = raw.is_a?(Hash) ? raw : JSON.parse(raw)
        raise ArgumentError, 'Configuração do veio inválida.' unless options.is_a?(Hash)
        mode = options['mode']
        raise ArgumentError, 'Ação de veio inválida.' unless %w[paint piece color angle align].include?(mode)
        angle = Parameters.number(options.fetch('angle', 90), 'Ângulo do veio', -36000, 36000) % 360
        count = nil
        if %w[color align].include?(mode)
          count = Finishing.change_grain(Sketchup.active_model, @scale_watcher, mode,
            material:@painting_tool.material, angle:angle)
          sync_selection
        else
          @painting_tool.grain_mode = mode
          @painting_tool.grain_angle = angle
        end
        send_to_panel('material_paint_active'=>true, 'material_paint_scope'=>@painting_tool.scope,
          'material_grain_mode'=>@painting_tool.grain_mode, 'material_grain_angle'=>@painting_tool.grain_angle,
          'material_grain_alignment'=>(mode == 'align' && count['changed'] > 0 ? angle : nil),
          'material_grain_result'=>count,
          'message'=>count ? Finishing.grain_result_message(count) :
            mode == 'paint' ? 'Pintura ativa.' : mode == 'angle' ? "Clique na peça para definir o veio a #{angle}°." : 'Clique na peça para girar o veio 90°. Esc encerra.')
      end
    end
    dialog.add_action_callback('stop_material_paint') do |_ctx|
      handle do
        tool = @painting_tool
        @painting_tool = nil
        tool.model.select_tool(nil) if tool && tool.active
        send_to_panel('material_paint_active' => false, 'material_paint_closed'=>true, 'message' => 'Pintura encerrada.')
      end
    end
  end

  def self.resume_material_paint
    tool = @painting_tool
    raise ArgumentError, 'Inicie novamente o pincel para este projeto.' unless tool && tool.model.equal?(Sketchup.active_model)
    tool.model.select_tool(tool) unless tool.active
    tool
  end
end
