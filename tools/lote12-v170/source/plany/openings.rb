# encoding: UTF-8
require File.join(__dir__, 'ui_feedback')
module RQMyDina
  # SketchUp dispatches Tool callbacks by their exact arity. Keep those
  # signatures when restoring the originating bridge context.
  module OpeningOperationCallbacks
    attr_accessor :operation_dispatch
    def activate; operation_dispatch.call(proc { super }); end
    def deactivate(view); operation_dispatch.call(proc { super }); end
    def onCancel(reason, view); operation_dispatch.call(proc { super }); end
    def onLButtonDown(flags, x, y, view); operation_dispatch.call(proc { super }); end
    def onMouseMove(flags, x, y, view); operation_dispatch.call(proc { super }); end
    def resume(view); operation_dispatch.call(proc { super }); end
  end

  class OpeningSelectionTool
    attr_reader :close_reason
    ACTION_LABELS = {
      'door' => 'Porta',
      'drawers' => 'Gaveta',
      'drawer_edit' => 'Gaveta',
      'shelf' => 'Prateleira',
      'divider' => 'Divisória'
    }.freeze

    def initialize(model, runtime, action = nil)
      @model, @runtime = model, runtime
      @action = ACTION_LABELS.key?(action.to_s) ? action.to_s : nil
      @entries = []
      @selected = {}
      @door_anchor_key = nil
      @door_anchor_side = nil
    end

    def activate
      @runtime.clear_opening_selection(false)
      refresh
      text = if @entries.empty?
        'Nenhum vão de caixaria disponível neste contexto.'
      elsif @action == 'door'
        'Porta: clique no primeiro vão e depois no limite oposto da área. Os vãos intermediários entram automaticamente. Esc cancela.'
      elsif @action == 'drawer_edit'
        'Gaveta: clique no novo vão de aplicação. Esc cancela a seleção.'
      elsif @action
        "#{ACTION_LABELS[@action]}: configuração aberta no Plany. Clique em um ou mais vãos; clique novamente para remover. Esc cancela."
      else
        'Selecione um vão. Ctrl adiciona; Shift alterna; Ctrl+Shift remove. Esc encerra.'
      end
      Sketchup.set_status_text(text)
      @runtime.send_to_panel('opening_tool' => @action) if @action
      @model.active_view.invalidate
    end

    def entry_key(entry)
      [Graph.key(entry[:path]), entry[:window]['id']]
    end

    def selected?(entry)
      @selected.key?(entry_key(entry))
    end

    def rectangle_overlap?(window, bounds)
      [window['x'] + window['width'], bounds[:x1]].min - [window['x'], bounds[:x0]].max > 1.0e-7 &&
        [window['z'] + window['height'], bounds[:z1]].min - [window['z'], bounds[:z0]].max > 1.0e-7
    end

    # Door selection is one composed rectangular area, never one door system per opening.
    # The first click becomes the anchor; every later click redefines the opposite corner.
    # Any openings between those two points are included automatically. On irregular
    # partitions the rectangle expands until it contains every opening it intersects.
    def door_rectangle_entries(target, anchor_entry, end_entry)
      selected = [anchor_entry, end_entry].compact.uniq
      candidates = @entries.select { |candidate| entry_key(candidate)[0] == target }
      loop do
        x0 = selected.map { |candidate| candidate[:window]['x'] }.min
        z0 = selected.map { |candidate| candidate[:window]['z'] }.min
        x1 = selected.map { |candidate| candidate[:window]['x'] + candidate[:window]['width'] }.max
        z1 = selected.map { |candidate| candidate[:window]['z'] + candidate[:window]['height'] }.max
        bounds = {x0:x0, z0:z0, x1:x1, z1:z1}
        expanded = candidates.select { |candidate| rectangle_overlap?(candidate[:window], bounds) }
        old_keys = selected.map { |candidate| entry_key(candidate) }.sort
        new_keys = expanded.map { |candidate| entry_key(candidate) }.sort
        return expanded if old_keys == new_keys
        selected = expanded
      end
    end

    def select_door_rectangle(entry, face)
      key = entry_key(entry)
      target = key[0]
      anchor_entry = @door_anchor_key && @entries.find { |candidate| entry_key(candidate) == @door_anchor_key }
      if anchor_entry.nil? || @door_anchor_key[0] != target
        @door_anchor_key = key
        @door_anchor_side = face
        @selected = {key => face}
        return
      end
      selected = door_rectangle_entries(target, anchor_entry, entry)
      @selected = selected.to_h { |candidate| [entry_key(candidate), @door_anchor_side || face] }
    end

    def windows_for(entity, revision)
      raw = entity.get_attribute(Geometry::DICTIONARY, 'parameters')
      signature = [entity.definition, raw]
      signature << revision if raw.to_s.include?('"assembly"')
      cached = @windows_cache[entity]
      return cached[:windows] if cached && cached[:signature] == signature
      windows = Parameters.windows(Geometry.read(entity))
      @windows_cache[entity] = {signature: signature, windows: windows}
      windows
    end

    def refresh
      prefix = @model.active_path || []
      revision = @runtime.opening_cache_key if @runtime.respond_to?(:opening_cache_key)
      document = revision && revision[0,2]
      @windows_cache = {} if !@windows_cache || document != @cache_document
      @cache_document = document
      key = revision && [revision, Graph.key(prefix), @model.layers.map { |layer| [layer.object_id, layer.visible?] }]
      if key && key == @refresh_key && @entries.all? { |entry| entry[:path].all? { |e| e.valid? && !e.hidden? && !e.locked? && e.layer.visible? } }
        @entries.each { |entry| entry[:transform] = Graph.transform(entry[:path]) }
        @refreshed_at = Time.now.to_f
        return
      end
      selected = @selected.dup
      @entries = []
      owner = prefix.rindex { |entity| Geometry.module?(entity) }
      if owner
        path = prefix[0..owner]
        windows_for(path.last, revision).each_with_index do |window,index|
          @entries << {path:path, window:window, number:index+1, transform:Graph.transform(path)}
        end
      end
      Graph.walk(@model.active_entities, prefix) do |path|
        entity = path.last
        next false if path.any? { |e| e.hidden? || e.locked? || !e.layer.visible? }
        if Geometry.module?(entity)
          windows_for(entity, revision).each_with_index do |window, index|
            @entries << {path:path, window:window, number:index+1, transform:Graph.transform(path)}
          end
          false
        else
          !Graph.registered?(entity)
        end
      end
      valid = @entries.map { |entry| entry_key(entry) }
      @selected = selected.select { |key,_side| valid.include?(key) }
      visible = @entries.map { |entry| entry[:path].last }.uniq
      @windows_cache.select! { |entity,_value| visible.include?(entity) }
      @refresh_key = key
      @refreshed_at = Time.now.to_f
    end

    def side(entry, view)
      direction = view.camera.direction.transform(entry[:transform].inverse)
      return 'front' if %w[door drawers drawer_edit].include?(@action)
      direction.y >= 0 ? 'front' : 'rear'
    end

    def pick(x, y, view)
      ray = view.pickray(x, y)
      @entries.filter_map do |entry|
        next unless entry[:path].all?(&:valid?)
        inverse = entry[:transform].inverse
        origin = ray[0].transform(inverse); direction = ray[1].transform(inverse)
        next if direction.y.abs < 1e-8
        next if %w[door drawers drawer_edit].include?(@action) && view.camera.direction.transform(inverse).y < 0
        face = side(entry, view); w = entry[:window]
        t = (w[face].mm - origin.y) / direction.y
        next unless t > 0
        point = Geom::Point3d.new(origin.to_a.zip(direction.to_a).map { |o,d| o+d*t })
        next unless point.x.to_mm.between?(w['x'],w['x']+w['width']) && point.z.to_mm.between?(w['z'],w['z']+w['height'])
        world = point.transform(entry[:transform])
        [world.distance(ray[0]), entry, face]
      end.min_by(&:first)
    end

    def modifier?(flags, constant)
      return false unless Object.const_defined?(constant)
      mask = Object.const_get(constant)
      mask && mask != 0 && (flags & mask) != 0
    rescue StandardError
      false
    end

    def onMouseMove(_flags, x, y, view)
      refresh if Time.now.to_f - @refreshed_at > 0.3
      hit = pick(x, y, view)
      @hover = hit && hit[1]
      if hit
        prefix = @action ? "#{ACTION_LABELS[@action]} · " : ''
        suffix = @action == 'door' && @door_anchor_key ? ' · redefinir área' : ''
        view.tooltip = "#{prefix}Vão #{hit[1][:number]} · #{hit[2] == 'front' ? 'frente' : 'trás'}#{suffix}"
      else
        view.tooltip = ''
      end
      view.invalidate
    end

    def onLButtonDown(flags, x, y, view)
      return unless Sketchup.active_model == @model
      refresh
      hit = pick(x, y, view)
      return unless hit
      entry, face = hit[1], hit[2]
      key = entry_key(entry)
      target = key[0]

      same_target = @selected.empty? || @selected.keys.all? { |selected_key| selected_key[0] == target }
      unless same_target
        @selected.clear
        @door_anchor_key = nil
        @door_anchor_side = nil
      end

      if @action == 'door'
        select_door_rectangle(entry, face)
      elsif @action == 'drawer_edit'
        @selected = {key => face}
      elsif @action
        # Gavetas, prateleiras e divisórias keep independent targets.
        @selected.key?(key) ? @selected.delete(key) : @selected[key] = face
      else
        ctrl = modifier?(flags, :COPY_MODIFIER_MASK)
        shift = modifier?(flags, :CONSTRAIN_MODIFIER_MASK)
        if ctrl && shift
          @selected.delete(key)
        elsif shift
          @selected.key?(key) ? @selected.delete(key) : @selected[key] = face
        elsif ctrl
          @selected[key] = face
        else
          @selected = {key => face}
        end
      end

      path = entry[:path]
      desired_path = path.length == 1 ? nil : path[0...-1]
      # Reassigning even the same active path can deactivate SketchUp's tool.
      @model.active_path = desired_path unless (@model.active_path || []) == (desired_path || [])
      unless @model.selection.to_a == [path.last]
        @model.selection.clear
        @model.selection.add(path.last)
      end

      items = @selected.filter_map do |selected_key, selected_side|
        selected_entry = @entries.find { |candidate| entry_key(candidate) == selected_key }
        selected_entry && [selected_entry[:path], selected_entry[:window]['id'], selected_side]
      end
      @runtime.select_opening_set(items, @action)
      view.invalidate
    rescue StandardError => error
      @runtime.send_to_panel('error'=>PlanyUiFeedback.user(error))
    end

    def draw_door_selection(view)
      return unless @action == 'door' && !@selected.empty?
      selected = @entries.select { |entry| selected?(entry) }
      return if selected.empty?
      x0 = selected.map { |entry| entry[:window]['x'] }.min
      z0 = selected.map { |entry| entry[:window]['z'] }.min
      x1 = selected.map { |entry| entry[:window]['x'] + entry[:window]['width'] }.max
      z1 = selected.map { |entry| entry[:window]['z'] + entry[:window]['height'] }.max
      first = selected.first
      face = @door_anchor_side || side(first, view)
      y = first[:window][face]
      points = [[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]]
        .map { |value| Geom::Point3d.new(value.map(&:mm)).transform(first[:transform]) }
      view.drawing_color = Sketchup::Color.new(0, 125, 82, 104)
      view.draw(GL_POLYGON, points)
    end

    def draw(view)
      @entries.each do |entry|
        next unless entry[:path].all?(&:valid?)
        w=entry[:window]; y=w[side(entry,view)]
        points=[[w['x'],y,w['z']],[w['x']+w['width'],y,w['z']],
          [w['x']+w['width'],y,w['z']+w['height']],[w['x'],y,w['z']+w['height']]]
          .map { |v| Geom::Point3d.new(v.map(&:mm)).transform(entry[:transform]) }

        if selected?(entry)
          unless @action == 'door'
            view.drawing_color = Sketchup::Color.new(0, 156, 96, 92)
            view.draw(GL_POLYGON, points)
          end
        elsif entry.equal?(@hover)
          view.drawing_color = Sketchup::Color.new(0, 156, 96, 42)
          view.draw(GL_POLYGON, points)
        else
          view.line_width = 1
          view.line_stipple = '-'
          view.drawing_color = '#91a99b'
          view.draw(GL_LINE_LOOP, points)
        end
      end
      draw_door_selection(view)
    end

    def resume(view); refresh; view.invalidate; end
    def onCancel(_reason, _view)
      @close_reason = 'cancelled'
      @runtime.clear_opening_selection
      @model.select_tool(nil)
    end
    def deactivate(view); @runtime.opening_tool_closed(self); view.invalidate; Sketchup.set_status_text(''); end
  end

  def self.select_openings(action = nil, loose = false, scope = nil, envelope = false)
    reloadable!
    action = action.to_s
    action = nil if action.empty?
    @loose_door_area = nil if loose
    @opening_envelope = nil
    if envelope && action=='door'
      model=Sketchup.active_model
      paths=scope ? Array(scope).map { |id| Graph.resolve(model,id) } : focused_paths(model)
      raise ArgumentError,'Selecione os módulos ou grupos da porta externa.' if paths.empty? || paths.any? { |path| path.empty? || path.any? { |e| !e.valid? || e.locked? } }
      stop_opening_tool
      if loose
        area=Volume.reference(paths)
        @loose_door_area=area.merge('model'=>model,'paths'=>paths)
        send_to_panel('loose_door_area'=>area.reject { |key,_| key=='transform' },'opening_tool'=>'door','message'=>'Porta externa: volume completo da seleção.')
      else
        raise ArgumentError,'A porta integrada precisa de um único módulo.' unless paths.length==1 && Geometry.module?(paths.first.last)
        @opening_envelope=Graph.key(paths.first)
        select_opening_set([[paths.first,'root','front']],'door')
      end
      return
    end
    tool = (loose && action == 'door' ? LooseDoorSelectionTool : OpeningSelectionTool).new(Sketchup.active_model, self, action)
    tool.scope = scope if tool.is_a?(LooseDoorSelectionTool)
    # Tool callbacks occur after the HtmlDialog callback has returned. Keep the
    # operation that owns this particular tool, including cancel/deactivation.
    tool.extend(OpeningOperationCallbacks)
    tool.operation_dispatch = operation_callback { |body| body.call }
    @opening_tool = tool
    @opening_session = @operation_contract && @operation_contract.context && @operation_contract.context['session_id']
    Sketchup.active_model.select_tool(tool)
  rescue StandardError => error
    PlanyUiFeedback.log(error)
    UI.messagebox(PlanyUiFeedback.user(error))
  end

  def self.opening_tool_closed(tool)
    if @opening_tool.equal?(tool)
      @opening_tool = nil
      send_to_panel('opening_tool' => nil, 'opening_cancelled' => tool.close_reason == 'cancelled') if @panel_ready
    end
  end

  def self.clear_opening_selection(sync = true)
    @opening_selections = []
    sync_selection if sync && @panel_ready
  end

  def self.select_opening_set(items, action = nil)
    items ||= []
    targets = items.map { |path,_id,_side| Graph.key(path) }.uniq
    raise ArgumentError, 'Selecione vãos do mesmo módulo para editar em conjunto.' if targets.length > 1
    @opening_selections = items.map do |path,id,side|
      {'target'=>Graph.key(path), 'id'=>id, 'side'=>side, 'model'=>Sketchup.active_model}
    end
    show_panel unless @dialog && @dialog.visible?
    sync_selection
    if action && !items.empty?
      message = if action == 'door'
        count = items.length
        "Área da porta atualizada: #{count} #{count == 1 ? 'vão' : 'vãos'}. Clique em outro vão para redefinir o retângulo ou conclua no Plany."
      elsif action == 'drawer_edit'
        'Vão da gaveta escolhido. Conclua a edição no Plany.'
      else
        "#{OpeningSelectionTool::ACTION_LABELS[action] || 'Ferramenta'} ativa. Continue clicando para incluir ou remover vãos; conclua no Plany."
      end
      send_to_panel('opening_action'=>action, 'opening_tool'=>action, 'message'=>message)
    elsif items.empty?
      send_to_panel('message'=>'Nenhum vão selecionado.')
    else
      count = items.length
      send_to_panel('activate_tab'=>'module', 'message'=>count == 1 ? 'Vão selecionado.' : "#{count} vãos selecionados.")
    end
  end

  def self.select_opening(path, id, side)
    select_opening_set([[path,id,side]], nil)
  end

  def self.opening_payloads(payload)
    selections = @opening_selections || []
    return [] if selections.empty?
    if payload['selection_kind'] != 'module'
      @opening_selections = []
      return []
    end
    action = @opening_tool && @opening_tool.instance_variable_get(:@action)
    windows = Parameters.windows(payload['params'])
    if @opening_envelope==payload['target_id']
      root=Parameters.layout(payload['params'])['nodes']['root']
      windows=windows+[root.merge('id'=>'root','depth'=>payload['params']['depth'],'front'=>0,'rear'=>payload['params']['depth'])]
    end
    valid = selections.filter_map do |selection|
      next unless selection['model'] == Sketchup.active_model && payload['target_id'] == selection['target']
      window = windows.find { |candidate| candidate['id'] == selection['id'] }
      window && window.merge('side'=>selection['side'])
    end
    @opening_selections = selections.select do |selection|
      valid.any? { |window| window['id'] == selection['id'] }
    end
    valid
  end
end
