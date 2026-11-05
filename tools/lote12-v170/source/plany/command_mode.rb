# encoding: UTF-8
require 'fiddle/import' if Sketchup.platform == :platform_win
require 'socket' if Sketchup.platform == :platform_win
require 'securerandom' if Sketchup.platform == :platform_win

module RQMyDina
  module CommandMode
    FAMILIES = {
      'c' => {label: 'CRIAR', color: '#aa78dc'},
      'b' => {label: 'BUSCAR', color: '#e4bb58'},
      'i' => {label: 'INSERIR', color: '#69c58c'},
      'a' => {label: 'AÇÃO', color: '#df7777'}
    }.freeze

    # These names are commands already supported by Plany. The family prefixes
    # are grammar, while additional names are per-user preferences.
    COMMANDS = [
      {id: 'cabinet', family: 'c', name: 'caixaria', aliases: %w[caixaria módulo modulo]},
      {id: 'piece_shelf', family: 'c', name: 'peça prateleira', aliases: ['peça prateleira', 'peca prateleira', 'prateleira'], piece: 'piece:shelf'},
      {id: 'piece_side', family: 'c', name: 'peça lateral', aliases: ['peça lateral', 'peca lateral', 'lateral'], piece: 'piece:side'},
      {id: 'piece_rail', family: 'c', name: 'peça régua', aliases: ['peça régua', 'peca regua', 'régua', 'regua'], piece: 'piece:rail'},
      {id: 'door', family: 'i', name: 'porta', aliases: %w[porta portas], insert: 'door'},
      {id: 'drawers', family: 'i', name: 'gaveta', aliases: %w[gaveta gavetas], insert: 'drawers'},
      {id: 'shelf', family: 'i', name: 'prateleira', aliases: %w[prateleira prateleiras], insert: 'shelf'},
      {id: 'divider', family: 'i', name: 'divisória', aliases: %w[divisória divisoria divisórias divisorias], insert: 'divider'},
      {id: 'cladding', family: 'i', name: 'tamponamento', aliases: %w[tamponamento tamponamentos], insert: 'cladding'},
      {id: 'baseboard', family: 'i', name: 'rodapé', aliases: %w[rodapé rodape], insert: 'baseboard'},
      {id: 'crown', family: 'i', name: 'rodateto', aliases: %w[rodateto], insert: 'crown'},
      {id: 'accessory', family: 'i', name: 'acessório', aliases: %w[acessório acessorio], insert: 'accessory'},
      {id: 'hide_fronts', family: 'a', name: 'ocultar frentes', aliases: ['ocultar frentes']},
      {id: 'show_fronts', family: 'a', name: 'mostrar frentes', aliases: ['mostrar frentes']}
    ].freeze

    def self.catalog
      COMMANDS.map { |entry| {'id' => entry[:id], 'family' => entry[:family], 'name' => entry[:name]} }
    end

    def self.fold(value)
      value.to_s.unicode_normalize(:nfkd).gsub(/\p{Mn}/, '').downcase.gsub(/\s+/, ' ').strip
    end

    def self.normalize_aliases(raw)
      raise ArgumentError, 'Apelidos dos comandos inválidos.' unless raw.is_a?(Hash)
      allowed = COMMANDS.map { |entry| entry[:id] }
      raise ArgumentError, 'Comando desconhecido nas configurações.' unless (raw.keys - allowed).empty?
      normalized = {}
      raw.each do |id, value|
        raise ArgumentError, 'Use um apelido de até 32 caracteres.' unless value.is_a?(String) && value.length <= 32
        alias_name = value.gsub(/\s+/, ' ').strip
        raise ArgumentError, 'Use letras, números e espaços nos apelidos.' unless alias_name.empty? || alias_name.match?(/\A[\p{L}\p{N}]+(?:[ \-][\p{L}\p{N}]+)*\z/)
        normalized[id] = alias_name unless alias_name.empty?
      end
      FAMILIES.each_key do |family|
        names = {}
        COMMANDS.select { |entry| entry[:family] == family }.each do |entry|
          (entry[:aliases] + [normalized[entry[:id]]].compact).each do |name|
            key = fold(name)
            raise ArgumentError, "O apelido #{name} corresponde a dois comandos de #{FAMILIES[family][:label]}." if names[key] && names[key] != entry[:id]
            names[key] = entry[:id]
          end
        end
      end
      normalized
    end

    def self.command_names(entry, aliases)
      (entry[:aliases] + [aliases[entry[:id]]].compact).map { |value| fold(value) }.uniq.sort_by { |value| -value.length }
    end

    def self.match_command(family, text, aliases)
      needle = fold(text)
      COMMANDS.select { |entry| entry[:family] == family }.flat_map do |entry|
        command_names(entry, aliases).filter_map do |name|
          next unless needle == name || needle.start_with?(name + ' ')
          [entry, name, needle.delete_prefix(name).strip]
        end
      end.max_by { |_entry, name, _tail| name.length }
    end

    def self.suggest_entries(family, text, aliases)
      query = fold(text)
      COMMANDS.each_with_index.filter_map do |entry, index|
        next unless entry[:family] == family
        score = command_names(entry, aliases).filter_map do |name|
          if query.empty? then 4
          elsif name == query then 0
          elsif name.start_with?(query) then 1
          elsif name.split.any? { |word| word.start_with?(query) } then 2
          elsif name.include?(query) then 3
          end
        end.min
        [score, index, entry] if score
      end.sort_by { |score, index, _entry| [score, index] }
        .map { |_score, _index, entry| {'id' => entry[:id], 'name' => entry[:name]} }
    end

    def self.suggest(family, text, aliases)
      suggest_entries(family, text, aliases).first(5).map { |entry| entry['name'] }
    end

    def self.search_saved(query, saved)
      key = fold(query)
      saved.each_with_index.filter_map do |entry, index|
        name = fold(entry['name'])
        score = if key.empty? then 4
                elsif name == key then 0
                elsif name.start_with?(key) then 1
                elsif name.split.any? { |word| word.start_with?(key) } then 2
                elsif name.include?(key) then 3
                end
        [score, name, index, entry] if score
      end.sort_by { |score, name, index, _entry| [score, name, index] }.map(&:last)
    end

    def self.result(family, state, detail, **more)
      info = FAMILIES[family] || {label: 'MODO COMANDOS', color: '#76a38c'}
      {family: family, label: info[:label], color: info[:color], state: state,
       detail: detail, suggestions: []}.merge(more)
    end

    def self.parse(buffer, saved: [], aliases: {}, module_selected: false)
      text = buffer.to_s.strip
      prefix = text.match(/\A([cbia])(?:;\s*|\s*)(.*)\z/i)
      return result(nil, :hint, 'Use C Criar · B Buscar · I Inserir · A Ação') unless prefix
      family = prefix[1].downcase
      body = prefix[2].strip
      if family == 'b'
        choices = search_saved(body, saved)
        return result(family, :incomplete, 'Nenhum módulo salvo encontrado.', choices: []) if choices.empty?
        if body.empty?
          return result(family, :incomplete, 'Digite para buscar · Enter confirma a opção destacada.',
                        choices: choices.first(6), suggestions: choices.first(4).map { |item| item['name'] })
        end
        return result(family, :ready, choices.first['name'], id: choices.first['id'],
                      choices: choices.first(6), suggestions: choices.first(4).map { |item| item['name'] })
      end
      if body.empty?
        return result(family, :incomplete, 'Digite para filtrar · ↑↓ escolhem · Enter confirma.', suggestions: suggest(family, '', aliases))
      end
      matched = match_command(family, body, aliases)
      unless matched
        options = suggest(family, body, aliases)
        return result(family, :incomplete, options.empty? ? 'Comando não reconhecido nesta família.' : 'Continue digitando ou escolha uma sugestão.', suggestions: options)
      end
      entry, _name, tail = matched
      case family
      when 'c'
        if entry[:id] == 'cabinet'
          values = tail.split
          return result(family, :ready, 'Caixaria · medidas padrão · clique no modelo para ancorar.', id: entry[:id], args: {}) if values.empty?
          if values.length < 3
            label = ['largura', 'altura', 'profundidade'][values.length]
            return result(family, :incomplete, "Informe a #{label} em mm.", id: entry[:id])
          end
          return result(family, :invalid, 'Use apenas largura, altura e profundidade.', id: entry[:id]) if values.length > 3
          begin
            dimensions = %w[width height depth].each_with_index.to_h do |key, index|
              min, max, label = Parameters::LIMITS.fetch(key)
              [key, Parameters.number(values[index], label, min, max)]
            end
            result(family, :ready, "Caixaria · #{dimensions.values.join(' × ')} mm · clique no modelo para posicionar.", id: entry[:id], args: dimensions)
          rescue ArgumentError => error
            result(family, :invalid, error.message, id: entry[:id])
          end
        else
          values = tail.split
          return result(family, :incomplete, 'Informe comprimento, largura e espessura, ou apague as medidas para usar o modelo padrão.', id: entry[:id]) if values.length.between?(1, 2)
          return result(family, :invalid, 'Use comprimento, largura e espessura.', id: entry[:id]) if values.length > 3
          begin
            dimensions = values.each_with_index.map { |value, index| Parameters.number(value, %w[Comprimento Largura Espessura][index], index == 2 ? 3 : 0.1, index == 2 ? 40 : 6000) }
            description = dimensions.empty? ? 'medidas padrão' : dimensions.join(' × ') + ' mm'
            result(family, :ready, "#{entry[:name].capitalize} · #{description} · clique no modelo para posicionar.", id: entry[:id], args: dimensions)
          rescue ArgumentError => error
            result(family, :invalid, error.message, id: entry[:id])
          end
        end
      when 'i'
        return result(family, :invalid, 'Selecione um módulo Plany antes de inserir.', id: entry[:id]) unless module_selected
        values = tail.split
        return result(family, :invalid, 'Este comando não aceita quantidade.', id: entry[:id]) if !%w[door drawers shelf divider].include?(entry[:id]) && !values.empty?
        return result(family, :invalid, 'Informe apenas uma quantidade.', id: entry[:id]) if values.length > 1
        quantity = values.empty? ? 1 : values.first.to_i
        limit = entry[:id] == 'door' ? 2 : 8
        return result(family, :invalid, "Use uma quantidade inteira de 1 a #{limit}.", id: entry[:id]) unless values.empty? || (values.first.match?(/\A[1-9]\d*\z/) && quantity.between?(1, limit))
        detail = "#{entry[:name].capitalize}#{quantity > 1 ? " · #{quantity}" : ''} · escolha o vão e conclua na configuração do Plany."
        result(family, :ready, detail, id: entry[:id], args: {'quantity' => quantity})
      when 'a'
        return result(family, :invalid, 'Esta ação não aceita argumentos.', id: entry[:id]) unless tail.empty?
        result(family, :ready, entry[:name].capitalize + ' no projeto.', id: entry[:id])
      end
    end

    # ToUnicodeEx translates only a key delivered to the active SketchUp Tool.
    # It is not a system hook and never observes typing while this Tool is off.
    if Sketchup.platform == :platform_win
      module Keyboard
        extend Fiddle::Importer
        dlload 'user32.dll'
        extern 'int GetKeyboardState(void*)'
        extern 'unsigned int MapVirtualKeyW(unsigned int, unsigned int)'
        extern 'int ToUnicodeEx(unsigned int, unsigned int, void*, void*, int, unsigned int, void*)'
        extern 'void* GetKeyboardLayout(unsigned int)'
        extern 'void* GetActiveWindow()'
        extern 'void* GetAncestor(void*, unsigned int)'
        extern 'int GetCursorPos(void*)'
        extern 'int ScreenToClient(void*, void*)'
        extern 'int GetClientRect(void*, void*)'
        extern 'int GetClassNameW(void*, void*, int)'
        extern 'int EnumChildWindows(void*, void*, void*)'
        extern 'int PeekMessageW(void*, void*, unsigned int, unsigned int, unsigned int)'
        extern 'short GetKeyState(int)'
        extern 'unsigned long MsgWaitForMultipleObjects(unsigned long, void*, int, unsigned long, unsigned long)'
      end
    end

    # Get the initial viewport position before SketchUp sends onMouseMove.
    # Use the same AfxFrameOrView viewport as the keyboard companion.
    def self.cursor_position(view)
      return unless defined?(Keyboard)
      parent = Keyboard.GetActiveWindow
      return if parent.to_i == 0
      viewport, area, client_size = nil, 0, nil
      name = Fiddle::Pointer.malloc(512)
      rect = Fiddle::Pointer.malloc(16)
      callback = Fiddle::Closure::BlockCaller.new(Fiddle::TYPE_INT, [Fiddle::TYPE_VOIDP, Fiddle::TYPE_VOIDP]) do |window, _data|
        count = Keyboard.GetClassNameW(window, name, 256)
        klass = name[0, count * 2].force_encoding('UTF-16LE').encode('UTF-8')
        if klass.start_with?('AfxFrameOrView') && Keyboard.GetClientRect(window, rect) != 0
          left, top, right, bottom = rect[0, 16].unpack('l<4')
          width, height = right - left, bottom - top
          if width * height > area
            viewport, area, client_size = window, width * height, [width, height]
          end
        end
        1
      end
      Keyboard.EnumChildWindows(parent, callback, 0)
      return unless viewport
      point = Fiddle::Pointer.malloc(8)
      return if Keyboard.GetCursorPos(point) == 0 || Keyboard.ScreenToClient(viewport, point) == 0
      x, y = point[0, 8].unpack('l<2')
      [x * view.vpwidth.to_f / client_size[0], y * view.vpheight.to_f / client_size[1]]
    rescue StandardError => error
      warn "[Plany] Posição inicial do menu: #{error.message}"
      nil
    end

    def self.character(key)
      if defined?(Keyboard)
        state = Fiddle::Pointer.malloc(256)
        output = Fiddle::Pointer.malloc(16)
        if Keyboard.GetKeyboardState(state) != 0
          scan = Keyboard.MapVirtualKeyW(key, 0)
          count = Keyboard.ToUnicodeEx(key, scan, state, output, 8, 0, Keyboard.GetKeyboardLayout(0))
          return output[0, count * 2].force_encoding('UTF-16LE').encode('UTF-8') if count == 1
        end
      end
      return key.chr.downcase if key.between?(65, 90)
      return key.chr if key.between?(48, 57)
      return ' ' if key == 32
      return ';' if [59, 186].include?(key)
      nil
    rescue StandardError
      nil
    end

    # SketchUp consumes assigned single-letter shortcuts before Tool#onKeyDown.
    # This small Windows companion intercepts only keys sent to the model view
    # while this tool is active. The local socket closes when the tool exits.
    module HelperProcess
      extend Fiddle::Importer
      dlload 'kernel32.dll'
      extern 'void* OpenProcess(unsigned long, int, unsigned long)'
      extern 'int TerminateProcess(void*, unsigned int)'
      extern 'int CloseHandle(void*)'
      extern 'unsigned long WaitForSingleObject(void*, unsigned long)'
      extern 'void* CreateEventW(void*, int, int, void*)'
      extern 'int SetEvent(void*)'
      extern 'int ResetEvent(void*)'
      extern 'unsigned long WaitForMultipleObjects(unsigned long, void*, int, unsigned long)'
    end if Sketchup.platform == :platform_win

    def self.native_keys
      @native_keys ||= NativeKeys.new
    end

    def self.prepare_native_keys
      native_keys.prepare if Sketchup.platform == :platform_win
    end

    def self.shutdown_native_keys
      @native_keys.dispose if @native_keys
      @native_keys = nil
    end

    class NativeKeys
      def initialize(tool = nil)
        @tool = tool
        @buffer = ''
        @ready = @prepared = false
        @next_session = 0
      end

      def prepared?
        @prepared && @process_handle && HelperProcess.WaitForSingleObject(@process_handle, 0) == 0x102
      end

      def prepare
        return true if prepared?
        dispose if @process_handle
        executable = File.join(__dir__, 'native', 'command_keys.exe')
        raise 'Captura de teclas do Plany não instalada.' unless File.file?(executable)
        @secret = SecureRandom.hex(20)
        @server = TCPServer.new('127.0.0.1', 0)
        event_name = 'Local\\PlanyCommandKeys-' + @secret
        @ready_event = HelperProcess.CreateEventW(0, 1, 0, (event_name + "\0").encode('UTF-16LE'))
        raise 'Não foi possível preparar a captura de teclas.' if @ready_event.to_i == 0
        capture_name = 'Local\\PlanyCommandKeysCapture-' + @secret
        @capture_event = HelperProcess.CreateEventW(0, 1, 0, (capture_name + "\0").encode('UTF-16LE'))
        raise 'Não foi possível preparar o controle de captura.' if @capture_event.to_i == 0
        @process = Process.spawn(executable, @server.addr[1].to_s, @secret, Process.pid.to_s,
                                 event_name, capture_name, out: File::NULL, err: File::NULL)
        @process_handle = HelperProcess.OpenProcess(0x00100001, 0, @process)
        raise 'Não foi possível acompanhar a captura de teclas.' if @process_handle.to_i == 0
        Process.detach(@process)
        unless wait_for_ready
          dispose
          return false
        end
        @client = @server.accept
        @client.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, 1)
        greeting = @client.gets
        raise 'A captura de teclas não foi autenticada.' unless greeting && greeting.strip == @secret
        @prepared = true
      rescue StandardError => error
        dispose
        warn "[Plany] Preparação do Modo Comandos indisponível: #{error.message}"
        false
      end

      def start(tool = @tool)
        stop if @timer || @ready
        @tool = tool
        return false unless prepare
        @tool = tool
        @session = (@next_session += 1).to_s
        @buffer.clear
        HelperProcess.ResetEvent(@ready_event)
        @client.write('on:' + @session + "\n")
        return false unless wait_for_ready
        loop do
          response = @client.gets
          raise 'A captura de teclas encerrou antes de iniciar.' unless response
          break if response.strip == 'active:' + @session
          # Frames from the preceding session cannot enter this one.
        end
        drain_pending_keys
        return false unless @tool && @tool.active?
        raise 'Não foi possível ativar a captura de teclas.' if HelperProcess.SetEvent(@capture_event) == 0
        @ready = true
        drain_pending_keys
        return false unless @tool && @tool.active?
        @timer = UI.start_timer(0.03, true) { poll }
        true
      rescue StandardError => error
        dispose
        warn "[Plany] Captura do Modo Comandos indisponível: #{error.message}"
        false
      end

      def ready?; @ready; end

      def stop
        # This synchronous kernel flag disables interception before any cleanup
        # or later socket callback. The process remains prepared but inactive.
        HelperProcess.ResetEvent(@capture_event) if @capture_event
        @ready = false
        @tool = @session = nil
        @buffer.clear
        begin
          UI.stop_timer(@timer) if @timer
          @timer = nil
        rescue StandardError => error
          # Keep the ID so an inactive poll can retry cancellation.
          warn "[Plany] Captura de teclas: #{error.message}"
        end
        nil
      end

      def dispose
        stop
        [@client, @server].compact.each do |io|
          begin; io.close unless io.closed?; rescue StandardError => error; warn "[Plany] Captura de teclas: #{error.message}"; end
        end
        if @process_handle && @process_handle.to_i != 0
          HelperProcess.TerminateProcess(@process_handle, 0)
          HelperProcess.CloseHandle(@process_handle)
        elsif @process
          # OpenProcess failed immediately after our own spawn, before detach.
          begin; Process.kill('KILL', @process); rescue SystemCallError; end
        end
        HelperProcess.CloseHandle(@ready_event) if @ready_event && @ready_event.to_i != 0
        HelperProcess.CloseHandle(@capture_event) if @capture_event && @capture_event.to_i != 0
        @client = @server = @ready_event = @capture_event = @process = @process_handle = nil
        @prepared = false
        nil
      end

      def wait_for_ready
        handles = [@process_handle.to_i, @ready_event.to_i].pack('Q<*')
        loop do
          active = @tool && @tool.active?
          drain_pending_keys if active
          return false if @tool.nil? && active
          event = if active
                    Keyboard.MsgWaitForMultipleObjects(2, handles, 0, 0xFFFFFFFF, 1)
                  else
                    HelperProcess.WaitForMultipleObjects(2, handles, 0, 0xFFFFFFFF)
                  end
          raise 'A captura de teclas encerrou antes de iniciar.' if event == 0
          raise 'Não foi possível iniciar a captura de teclas.' unless [1, 2].include?(event)
          if event == 1
            drain_pending_keys if active
            return !active || !!(@tool && @tool.active?)
          end
        end
      end

      def poll
        return stop unless @tool && @tool.active?
        if !@client
          accepted = @server.accept_nonblock(exception: false)
          @client = accepted unless accepted == :wait_readable
          return
        end
        chunk = @client.read_nonblock(4096, exception: false)
        return if chunk == :wait_readable
        if chunk.nil?
          dispose
          Sketchup.set_status_text('Modo Comandos: captura de teclas interrompida. Recarregue o Plany.')
          return
        end
        @buffer << chunk
        while @tool && @tool.active? && (newline = @buffer.index("\n"))
          line = @buffer.slice!(0..newline).strip
          next unless @ready && (event = line.match(/\A(\d+):(\d+):([0-9A-F]*)\z/)) && event[1] == @session
          character = [event[3]].pack('H*').force_encoding('UTF-8')
          next unless character.valid_encoding?
          @tool.receive_native_key(event[2].to_i, character)
        end
      rescue IOError, SystemCallError => error
        warn "[Plany] Captura de teclas interrompida: #{error.message}"
        dispose
      end

      def drain_pending_keys
        message = Fiddle::Pointer.malloc(48) # MSG on the supported 64-bit host.
        name = Fiddle::Pointer.malloc(512)
        parent = Keyboard.GetActiveWindow
        while @tool && @tool.active? && Keyboard.PeekMessageW(message, 0, 0x100, 0x100, 0) != 0
          window = message[0, 8].unpack1('Q<')
          count = Keyboard.GetClassNameW(window, name, 256)
          klass = name[0, count * 2].force_encoding('UTF-16LE').encode('UTF-8')
          qt_model=klass.start_with?('Qt') && Keyboard.GetAncestor(window,2).to_i==parent.to_i
          break unless window == parent.to_i || klass.start_with?('AfxFrameOrView', 'Afx:ToolBar') || qt_model
          break if [0x11, 0x12, 0x5B, 0x5C].any? { |key| (Keyboard.GetKeyState(key) & 0x8000) != 0 }
          key = message[16, 8].unpack1('Q<')
          character = CommandMode.character(key)
          break unless [8, 13, 27, 38, 40].include?(key) || character && character.match?(/\A[\p{L}\p{N} ;,.\-+]\z/)
          Keyboard.PeekMessageW(message, 0, 0x100, 0x100, 1)
          @tool.receive_native_key(key, character)
        end
      end
    end

    class Tool
      def initialize(model, runtime)
        @model, @runtime = model, runtime
        @generation = runtime.instance_variable_get(:@operation_generation)
        @buffer = ''
        @choice_index = 0
        @confirmed_choice = nil
        @active = false
        @saved = nil
        @settings = nil
        @native_keys = nil
      end

      def active?; @active && @runtime.instance_variable_get(:@operation_generation).equal?(@generation); end
      def model_view; @model.active_view; end

      def activate
        @active = true
        @settings = Settings.load
        @runtime.command_mode_activated(self)
        if Sketchup.platform == :platform_win
          @native_keys = CommandMode.native_keys
          unless @native_keys.start(self)
            @model.select_tool(nil) if active?
            Sketchup.set_status_text('Modo Comandos: captura de teclas indisponível.')
            return
          end
        end
        return unless active?
        @cursor_x, @cursor_y = CommandMode.cursor_position(@model.active_view)
        Sketchup.set_status_text('Modo Comandos ligado · digite C, B, I ou A. Enter confirma.')
        @model.active_view.invalidate
        @model.active_view.refresh
      end

      def deactivate(view)
        @active = false
        @native_keys.stop if @native_keys
        @runtime.command_mode_deactivated(self)
        Sketchup.set_status_text('')
        view.invalidate
      end

      def onCancel(_reason, view)
        @buffer = ''
        @choice_index = 0
        @confirmed_choice = nil
        @model.select_tool(nil)
      end

      def onKeyDown(key, _repeat, flags, view)
        handle_key(key, nil, flags, view)
      end

      def receive_native_key(key, character)
        handle_key(key, character, 0, @model.active_view) if active?
      end

      def onMouseMove(_flags, x, y, view)
        @cursor_x, @cursor_y = x, y
        view.invalidate
      end

      def handle_key(key, character, flags, view)
        if key == 27
          @buffer = ''
          @choice_index = 0
          @confirmed_choice = nil
          @model.select_tool(nil)
          return true
        end
        space_confirms = key == 32 && @settings['command_space_as_enter'] == true &&
                         (flags & (COPY_MODIFIER_MASK | ALT_MODIFIER_MASK)) == 0
        if key == 13 || space_confirms
          execute(view)
          return true
        end
        if key == 8
          @buffer = @buffer.chars[0...-1].join
          @choice_index = 0
          @confirmed_choice = nil unless confirmed_choice?
          view.invalidate
          return true
        end
        if key == 38 || key == 40
          choices = menu_choices(preview)
          @choice_index = (@choice_index + (key == 40 ? 1 : -1)) % choices.length unless choices.empty?
          view.invalidate
          return true
        end
        # Let native modifier shortcuts such as Ctrl+Z keep their own meaning.
        return false if (flags & COPY_MODIFIER_MASK) != 0 || (flags & ALT_MODIFIER_MASK) != 0
        letter = character && !character.empty? ? character : CommandMode.character(key)
        return false unless letter && letter.match?(/\A[\p{L}\p{N} ;,.\-+]\z/)
        if letter == ';' && @buffer.match?(/\A[cbia]/i)
          return true if @buffer.strip.length == 1 # Accept the former family separator without requiring it.
          unless confirm_choice(view)
            @buffer = @buffer.rstrip + ' '
            view.invalidate
          end
          return true
        end
        if @buffer.length < 140
          @buffer << letter
          @choice_index = 0
          view.invalidate
        end
        true
      end

      def onLButtonDown(flags, x, y, view)
        helper = view.pick_helper
        helper.do_pick(x, y)
        target = nil
        helper.count.times do |index|
          path = helper.path_at(index)
          next unless path
          target = path.find { |entity| entity.parent == @model.active_entities && Geometry.module?(entity) }
          target ||= path.find { |entity| entity.parent == @model.active_entities }
          break if target
        end
        return unless target && target.respond_to?(:valid?) && target.valid?
        selection = @model.selection
        selection.clear unless (flags & COPY_MODIFIER_MASK) != 0
        selection.add(target)
        view.invalidate
      rescue StandardError => error
        Sketchup.set_status_text("Seleção no Modo Comandos: #{error.message}")
      end

      def preview
        if confirmed_choice? && @confirmed_choice['family'] == 'b'
          return CommandMode.result('b', :ready, @confirmed_choice['name'],
                                    id: @confirmed_choice['id'], choices: [@confirmed_choice])
        end
        @saved ||= Library.list['saved'] if @buffer.match?(/\Ab/i)
        data = CommandMode.parse(@buffer, saved: @saved || [], aliases: @settings['command_aliases'],
                                 module_selected: @buffer.match?(/\Ai/i) && @runtime.command_module_selected?)
        if !menu_choices(data).empty? && data[:state] != :invalid
          data = data.merge(detail: 'Digite para filtrar · ↑↓ escolhem · Enter confirma.')
        end
        data
      end

      def confirmed_choice?
        return false unless @confirmed_choice
        prefix = @confirmed_choice['prefix']
        return @buffer.strip == prefix if @confirmed_choice['family'] == 'b'
        @buffer == prefix || @buffer.start_with?(prefix + ' ')
      end

      def menu_choices(data)
        return [] unless @settings['command_suggestions'] && !confirmed_choice?
        prefix = @buffer.strip.match(/\A([cbia])(?:;\s*|\s*)(.*)\z/i)
        return [] unless prefix
        family, body = prefix[1].downcase, prefix[2].strip
        return data[:choices] || [] if family == 'b'
        matched = CommandMode.match_command(family, body, @settings['command_aliases'])
        return [] if matched && !matched[2].empty?
        CommandMode.suggest_entries(family, body, @settings['command_aliases'])
      end

      def confirm_choice(view)
        choices = menu_choices(preview)
        return false if choices.empty?
        selected = choices[@choice_index] || choices.first
        family = @buffer[0].downcase
        prefix = "#{family} #{selected['name']}"
        @confirmed_choice = selected.merge('family' => family, 'prefix' => prefix)
        @buffer = prefix + ' '
        @choice_index = 0
        view.invalidate
        true
      end

      def refresh_settings
        @settings = Settings.load
        @model.active_view.invalidate if @active
      end

      def execute(view)
        confirm_choice(view)
        parsed = preview
        if parsed[:state] != :ready
          Sketchup.set_status_text(parsed[:detail])
          view.invalidate
          return
        end
        if parsed[:family] == 'b'
          choices = parsed[:choices]
          selected = choices[@choice_index] || choices.first
          parsed = parsed.merge(id: selected['id'], detail: selected['name'])
        end
        @runtime.execute_command_mode(parsed)
        @buffer = ''
        @choice_index = 0
        @confirmed_choice = nil
        view.invalidate if @active
        # Comandos remains active between commands; only Esc or choosing a
        # different SketchUp tool ends the tool session.
      rescue StandardError => error
        warn "[Plany] Modo Comandos: #{error.full_message}"
        Sketchup.set_status_text("Modo Comandos: #{error.message}")
      end

      def draw(view)
        data = preview
        width = [300, view.vpwidth - 24].min
        return if width < 180
        choices = menu_choices(data)
        start = [@choice_index - 1, 0].max
        start = [start, [choices.length - 3, 0].max].min
        suggestions = choices[start, 3] || []
        height = 46 + suggestions.length * 17
        x = @cursor_x ? [[@cursor_x + 20, view.vpwidth - width - 12].min, 12].max : 18
        y = @cursor_y ? [[@cursor_y + 18, view.vpheight - height - 12].min, 12].max : 20
        view.drawing_color = '#13211d'
        view.draw2d(GL_QUADS, quad(x, y, width, height))
        view.drawing_color = data[:color]
        view.draw2d(GL_QUADS, quad(x, y, 4, height))
        title = @buffer.empty? ? '>_  Modo Comandos' : ">_  #{@buffer} · #{data[:label]}"
        draw_line(view, x + 10, y + 7, title, data[:color], 8.75, true)
        draw_line(view, x + 10, y + 25, data[:detail], data[:state] == :invalid ? '#f19b93' : '#c7d5cc', 8.5)
        suggestions.each_with_index do |entry, index|
          selected = start + index == @choice_index
          row_y = y + 43 + index * 17
          if selected
            view.drawing_color = data[:color]
            view.draw2d(GL_QUADS, quad(x + 8, row_y - 1, width - 16, 17))
          end
          draw_line(view, x + 12, row_y, entry['name'], selected ? '#13211d' : '#b6c3ba', 8.5, selected)
        end
      end

      def quad(x, y, width, height)
        [[x,y,0],[x+width,y,0],[x+width,y+height,0],[x,y+height,0]].map { |point| Geom::Point3d.new(*point) }
      end

      def draw_line(view, x, y, text, color, size, bold = false)
        line = text.to_s
        line = line[0, 47] + '…' if line.length > 48
        view.draw_text(Geom::Point3d.new(x, y, 0), line, font: 'Segoe UI', color: color, size: size, bold: bold)
      end
    end
  end
end
